// gen.js
const fs = require('fs');
const path = require('path');

const OUTPUT_DIR = './data/test/raw';
const DAYS_BACK = parseInt(process.argv[2], 10) || 1;

function pad(n) {
  return n < 10 ? `0${n}` : `${n}`;
}

function formatDate(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatTimestamp(d) {
  return `${formatDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
}

function generateDayData(date) {
  const rows = [];
  let start = new Date(date);
  start.setHours(3, 0, 0, 0); // start at 3 AM

  const rowCount = 32 + Math.floor(Math.random() * 33); // 32-64

  for (let i = 0; i < rowCount; i++) {
    const strikes = Math.random() < 0.95 ? 0 : Math.random() < 0.5 ? 1 : 2;
    const length = 330 + Math.floor(Math.random() * 61); // ~360 ±30
    const hour = start.getHours();

    let value = 12;
    if (hour >= 3 && hour < 6) value = 15;
    else if (hour >= 6 && hour < 9) value = 13;

    rows.push(`${formatTimestamp(start)},${strikes},${length},${value}`);

    start = new Date(start.getTime() + length * 1000);
  }

  return `time,strikes,length,value\n${rows.join('\n')}`;
}

// Ensure output dir
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

for (let i = 0; i < DAYS_BACK; i++) {
  const date = new Date();
  date.setDate(date.getDate() - i);

  const data = generateDayData(date);
  const fileName = `${formatDate(date)}.csv`;
  const filePath = path.join(OUTPUT_DIR, fileName);

  fs.writeFileSync(filePath, data);
  console.log(`Wrote ${fileName}`);
}
