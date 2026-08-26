import { findTailStart, countMessageChars } from "./rounds.js";
import { writeCarryforwardNote, heuristicNote } from "./summarizer.js";
import { buildCharPlan, buildWindowPlan, measurePressure } from "./thresholds.js";
import { repairMessageIntegrity } from "./integrity.js";
import { snipHistoricText } from "./snip.js";
import { pruneHistoricToolOutputs } from "./tool-pruner.js";
import type {
  CondenseOutcome,
  ContextPackerOptions,
  PackingMutableState,
  PackingPressure,
  RunPackingInput,
} from "./types.js";

const DEFAULT_TAIL_KEEP = 12;
const DEFAULT_REFILL_WINDOW = 3;
const DEFAULT_REFILL_LIMIT = 3;
const DEFAULT_FAILURE_LIMIT = 3;

export class ContextPacker<TMessage> {
  private readonly options: ContextPackerOptions<TMessage>;
  private readonly state: PackingMutableState;

  constructor(options: ContextPackerOptions<TMessage>) {
    this.options = options;
    this.state = {
      stepIndex: 0,
      lastCondenseStep: -1,
      refillStreak: 0,
      failureStreak: 0,
      warningRaised: false,
      pruneRatchet: { floor: 0, batch: 8 },
    };
  }

  inspect(
    messages: TMessage[],
    usageTokens?: number,
  ): PackingPressure {
    const chars = countMessageChars(messages, this.options.adapter);
    return measurePressure(
      usageTokens,
      chars,
      buildWindowPlan(this.options.thresholds),
      this.options.charFallback ?? buildCharPlan(this.options.thresholds),
    );
  }

  async runCycle(
    input: RunPackingInput<TMessage>,
  ): Promise<CondenseOutcome<TMessage>> {
    const trigger = input.trigger ?? "automatic";
    this.state.stepIndex++;

    const pressure = this.inspect(input.messages, input.usageTokens);
    const keepTailMessages =
      this.options.keepTailMessages ?? DEFAULT_TAIL_KEEP;
    const refillWindowSteps =
      this.options.refillWindowSteps ?? DEFAULT_REFILL_WINDOW;
    const refillLimit = this.options.refillLimit ?? DEFAULT_REFILL_LIMIT;
    const condenseFailureLimit =
      this.options.condenseFailureLimit ?? DEFAULT_FAILURE_LIMIT;

    let workingMessages = input.messages;

    // ── Phase 1: Micro-compaction (trim old tool outputs) ──
    if (pressure.shouldWarn && !pressure.shouldCondense) {
      const trimOutcome = pruneHistoricToolOutputs(
        workingMessages,
        this.options.adapter,
        // Engine owns the ratchet state so the prune boundary is byte-stable
        // across turns (see ToolPrunePolicy.ratchet). Reset on condense.
        { ...this.options.toolPrune, ratchet: this.state.pruneRatchet },
      );
      if (trimOutcome.modified) {
        workingMessages = trimOutcome.messages;
        await this.options.callbacks?.onTrim?.({
          source: "tool-prune",
          freedUnits: trimOutcome.freedUnits,
          keptRecentToolOutputs:
            this.options.toolPrune?.keepRecentToolOutputs ?? 10,
        });
        await this.options.callbacks?.onCleanup?.({ mode: "warning" });
        return {
          mode: "trimmed",
          messages: workingMessages,
          pressure,
        };
      }
    }

    // ── Phase 1.5: Snip long historical plain-text messages ──
    if (pressure.shouldWarn && !pressure.shouldCondense) {
      const snipOutcome = snipHistoricText(
        workingMessages,
        this.options.adapter,
        this.options.snip,
      );
      if (snipOutcome.modified) {
        workingMessages = snipOutcome.messages;
        await this.options.callbacks?.onTrim?.({
          source: "snip",
          freedUnits: snipOutcome.freedUnits,
        });
        await this.options.callbacks?.onCleanup?.({ mode: "warning" });
        return {
          mode: "trimmed",
          messages: workingMessages,
          pressure: this.inspect(workingMessages, input.usageTokens),
        };
      }
    }

    // ── Phase 2: Check if full condense is needed ──
    if (!pressure.shouldCondense || workingMessages.length <= keepTailMessages + 2) {
      if (pressure.shouldWarn && !this.state.warningRaised) {
        this.state.warningRaised = true;
        await this.options.callbacks?.onWarning?.({
          observedSize: pressure.observedSize,
          threshold: pressure.condenseThreshold,
          usingTokens: pressure.usingTokens,
        });
      }
      return {
        mode: "none",
        messages: workingMessages,
        pressure,
      };
    }

    // ── Phase 3: Find split point ──
    const cutPoint = findTailStart(
      workingMessages,
      this.options.adapter,
      keepTailMessages,
    );
    if (cutPoint === null) {
      return {
        mode: "none",
        messages: workingMessages,
        pressure,
      };
    }

    // ── Phase 4: Thrashing detection ──
    // Must run AFTER findTailStart succeeds — otherwise "can't split" cycles
    // would be misidentified as thrashing and throw a fatal error.
    const turnsSinceCondense = this.state.stepIndex - this.state.lastCondenseStep;
    if (
      this.state.lastCondenseStep >= 0 &&
      turnsSinceCondense < refillWindowSteps
    ) {
      this.state.refillStreak++;
      if (this.state.refillStreak >= refillLimit) {
        throw new Error(
          `Context refill loop detected: threshold was crossed again within ${refillWindowSteps} steps, ${refillLimit} times in a row.`,
        );
      }
    } else {
      this.state.refillStreak = 0;
    }

    await this.options.callbacks?.onBeforeCondense?.({
      messages: workingMessages,
      observedSize: pressure.observedSize,
    });

    const removable = workingMessages.slice(0, cutPoint);
    let retained = workingMessages.slice(cutPoint);

    // ── Phase 5: Generate carry-forward note ──
    // Ledger snapshot (if any) provides the previous note for incremental updates,
    // NOT a replacement for summarization. New messages are always summarized.
    const digestSnapshot = this.options.ledger?.readSnapshot
      ? await this.options.ledger.readSnapshot()
      : null;
    const previousNote = digestSnapshot?.note ?? this.state.carryforwardNote;

    let carryforwardNote: string;
    const summarizer = this.options.summarizer;
    if (!summarizer) {
      // No summarizer available — use heuristic
      carryforwardNote = heuristicNote(removable, this.options.adapter);
    } else {
      try {
        carryforwardNote = await writeCarryforwardNote(
          removable,
          this.options.adapter,
          summarizer,
          previousNote,
        );
        this.state.failureStreak = 0;
      } catch (error) {
        this.state.failureStreak++;
        if (this.state.failureStreak >= condenseFailureLimit) {
          throw new Error(
            `Condense failed ${condenseFailureLimit} times in a row: ${(error as Error).message}`,
          );
        }
        // Degrade to heuristic on single failure
        carryforwardNote = heuristicNote(removable, this.options.adapter);
      }
    }

    if (digestSnapshot) {
      await this.options.ledger?.markApplied?.(digestSnapshot);
    }

    this.state.carryforwardNote = carryforwardNote;
    this.state.lastCondenseStep = this.state.stepIndex;
    this.state.warningRaised = false;
    // The rebuilt array invalidates outcome ordinals — restart the ratchet.
    this.state.pruneRatchet.floor = 0;

    // ── Phase 6: Rebuild message array ──
    const carryforward = this.options.adapter.createCarryforwardMessage({
      note: carryforwardNote,
      removedCount: removable.length,
      trigger,
      sizeBefore: pressure.observedSize,
      usingTokens: pressure.usingTokens,
    });

    // Only insert preamble if retained starts with a user message,
    // to avoid illegal sequences (assistant→assistant, assistant→toolResult).
    const safeForPreamble =
      retained.length > 0 &&
      this.options.adapter.getRole(retained[0]!) === "user";
    const preamble = safeForPreamble
      ? this.options.adapter.createPreambleMessages?.({
          note: carryforwardNote,
          removedCount: removable.length,
        }) ?? []
      : [];

    // Phase 3b — carry-forward attachments (recent files, plan/memory).
    // Inserted between preamble and retained so the compact metadata
    // (carryforward + preamble) stays adjacent while attachments sit next
    // to the preserved user tail.
    const attachments: TMessage[] = [];
    const providers = this.options.attachmentProviders ?? [];
    if (providers.length > 0) {
      const ctx = { trigger, removedCount: removable.length };
      for (const provider of providers) {
        try {
          const msgs = await provider(ctx);
          if (msgs && msgs.length > 0) attachments.push(...msgs);
        } catch (err: any) {
          // Attachment failure must not block the compact itself — the
          // summary + retained tail are already the fallback.
          console.error(
            `[context-packer] attachment provider threw: ${err?.message ?? err}`,
          );
        }
      }
    }

    let rebuilt = [carryforward, ...preamble, ...attachments, ...retained];
    const integrityOutcome = repairMessageIntegrity(
      rebuilt,
      this.options.adapter,
    );
    rebuilt = integrityOutcome.messages;

    await this.options.callbacks?.onAfterCondense?.({
      note: carryforwardNote,
      removedCount: removable.length,
    });
    await this.options.callbacks?.onCleanup?.({ mode: "condense" });

    return {
      mode: "condensed",
      messages: rebuilt,
      pressure,
      note: carryforwardNote,
      removedCount:
        removable.length + integrityOutcome.removedMessages,
    };
  }
}
