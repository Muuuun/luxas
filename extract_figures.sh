#!/bin/bash

# Script to extract figures from 4 core papers about TSV, RF, and 3D wiring

set -e

DATA_DIR="/Users/muqiao/Documents/Sisyphus/data"
PAPERS_DIR="$DATA_DIR/papers"
REPORTS_DIR="$DATA_DIR/reports"
FIGURES_DIR="$REPORTS_DIR/figures"

# Create figures directory if it doesn't exist
mkdir -p "$FIGURES_DIR"

# Define papers to process: paper_id, short_key, priority_type
papers=(
    "86563b230753472d83d7f3afa05ad8c55a11ee2e:tsv_integrated:TSV integration"
    "4e42e727f0ace2c1fa0b0dddbf3163904d241345:rf_performance:RF performance"
    "a847069481b2bc28768340af9998b47ab79f6d8b:quantum_socket:3D wiring"
    "a14fcc19636bab900033fd12f4336c0b9fb41628:glass_si:Glass vs Si"
)

# Function to extract figures from a paper
process_paper() {
    local paper_id=$1
    local paper_key=$2
    local paper_type=$3

    local paper_dir="$PAPERS_DIR/$paper_id"
    local source_dir="$paper_dir/source"
    local figures_dir="$paper_dir/figures"

    echo "=========================================="
    echo "Processing: $paper_type ($paper_key)"
    echo "Paper ID: $paper_id"
    echo "=========================================="

    if [ ! -d "$source_dir" ]; then
        echo "ERROR: Source directory not found: $source_dir"
        return 1
    fi

    # Create figures directory
    mkdir -p "$figures_dir"

    # Check what's in source directory
    echo "Contents of $source_dir:"
    ls -la "$source_dir"
    echo ""

    # Check for LaTeX source (texmf, tex files)
    has_latex=false
    has_pdf=false

    if [ -f "$source_dir/texmf" ] || [ -d "$source_dir/texmf" ] || ls "$source_dir"/*.tex > /dev/null 2>&1; then
        has_latex=true
        echo "✓ Found LaTeX source"
    fi

    if ls "$source_dir"/*.pdf > /dev/null 2>&1; then
        has_pdf=true
        echo "✓ Found PDF"
    fi

    # Extract figures based on what we have
    if [ "$has_latex" = true ]; then
        echo "Scanning LaTeX directories for image files..."

        # Find all image files in source directory and subdirectories
        find "$source_dir" \( -name "*.png" -o -name "*.eps" -o -name "*.pdf" -o -name "*.jpg" -o -name "*.jpeg" \) | while read -r image_file; do
            # Check file size (skip if < 10KB)
            size=$(stat -f%z "$image_file" 2>/dev/null || echo "0")
            if [ "$size" -gt 10240 ]; then
                filename=$(basename "$image_file")
                echo "  Copying: $filename ($size bytes)"
                cp "$image_file" "$figures_dir/"
            else
                filename=$(basename "$image_file")
                echo "  Skipping: $filename ($size bytes, too small)"
            fi
        done
    elif [ "$has_pdf" = true ]; then
        echo "Extracting figures from PDF using pdfimages..."

        # Create temp directory for extraction
        tmp_figs="/tmp/figs_${paper_key}"
        rm -rf "$tmp_figs"
        mkdir -p "$tmp_figs"

        # Extract images from all PDFs
        for pdf in "$source_dir"/*.pdf; do
            if [ -f "$pdf" ]; then
                echo "  Extracting from: $(basename "$pdf")"
                pdfimages -png "$pdf" "$tmp_figs/fig" || pdfimages -j "$pdf" "$tmp_figs/fig" || true
            fi
        done

        # Copy extracted images > 10KB
        if [ -d "$tmp_figs" ]; then
            find "$tmp_figs" -type f \( -name "*.png" -o -name "*.jpg" -o -name "*.jpeg" \) | while read -r image_file; do
                size=$(stat -f%z "$image_file" 2>/dev/null || echo "0")
                if [ "$size" -gt 10240 ]; then
                    filename=$(basename "$image_file")
                    echo "  Copying: $filename ($size bytes)"
                    cp "$image_file" "$figures_dir/"
                fi
            done
        fi
    else
        echo "WARNING: No LaTeX source or PDF found"
    fi

    # List extracted figures
    echo "Extracted figures in $figures_dir:"
    if [ -f "$figures_dir" ] && [ "$(ls -A "$figures_dir" 2>/dev/null)" ]; then
        ls -lh "$figures_dir" | awk 'NR>1 {print "  " $9 " (" $5 ")"}'
    else
        echo "  (No figures extracted)"
    fi

    echo ""
}

# Process all papers
for paper_info in "${papers[@]}"; do
    IFS=':' read -r paper_id paper_key paper_type <<< "$paper_info"
    process_paper "$paper_id" "$paper_key" "$paper_type"
done

echo "=========================================="
echo "Figure extraction complete!"
echo "=========================================="
