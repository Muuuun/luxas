/**
 * Python's site module prints this block to stderr on every interpreter start
 * when a .pth file in site-packages fails to load (site.addpackage):
 *
 *   Error processing line 1 of /usr/lib/python3/dist-packages/matplotlib-3.6.3-nspkg.pth:
 *
 *     Traceback (most recent call last):
 *       File "<frozen site>", line 201, in addpackage
 *       ...
 *     AttributeError: 'NoneType' object has no attribute 'loader'
 *
 *   Remainder of file ignored
 *
 * The droplet's system python does this (Ubuntu's matplotlib 3.6.3 namespace
 * .pth on Python 3.12). Gates that read a child python's output there found a
 * traceback the code under test never wrote, and their JSON parses of that
 * output failed: smoke_designbench, smoke_simrun and smoke_simrun_ssh were red
 * on the droplet on 2026-10-25 and green on the Mac. This removes exactly that
 * block, wherever it appears (a runner's own child processes print it too),
 * and nothing else.
 */
const SITE_PTH_ERROR = /Error processing line \d+ of [^\n]*\.pth:\n\n(?: {2}[^\n]*\n)*\nRemainder of file ignored\n/g;

export function withoutSiteNoise(text: string): string {
  return text.replace(SITE_PTH_ERROR, "");
}
