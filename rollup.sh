#!/bin/bash

# Ensure data/data.csv exists
if [ ! -f "data/data.csv" ]; then
    echo "Error: data/data.csv does not exist. Please create it with headers (time,strikes,length,cost)."
    exit 1
fi

# Check if data/raw/ contains any CSV files
if ! ls data/raw/*.csv >/dev/null 2>&1; then
    echo "No CSV files found in data/raw/."
    exit 0
fi

# Append all CSVs (skipping headers) to data/data.csv, add newline, and delete each file
for file in data/raw/*.csv; do
    tail -n +2 "$file" >> data/data.csv && echo "" >> data/data.csv && rm "$file"
done

echo "Concatenated all CSVs from data/raw/ to data/data.csv with newlines and cleared data/raw/."