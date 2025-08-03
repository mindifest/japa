#!/bin/bash

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RAW_DIR="$DIR/data/test/raw"
OUTPUT_FILE="$DIR/data/test/data.csv"

# Ensure data.csv exists
if [ ! -f "$OUTPUT_FILE" ]; then
    echo "Error: $OUTPUT_FILE does not exist. Please create it with headers (time,strikes,length,cost)."
    exit 1
fi

# Check for any CSVs in raw/
if ! ls "$RAW_DIR"/*.csv >/dev/null 2>&1; then
    echo "No CSV files found in $RAW_DIR."
    exit 0
fi

# Append all CSVs (skip header), newline, then delete
for file in "$RAW_DIR"/*.csv; do
    tail -n +2 "$file" >> "$OUTPUT_FILE" && echo "" >> "$OUTPUT_FILE" && rm "$file"
done

echo "Merged raw CSVs into data.csv and cleared raw/."
