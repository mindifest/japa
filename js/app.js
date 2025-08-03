import * as duckdb from 'https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.28.0/+esm';

function normalizeRow(row) {
    const normalized = {};
    for (const key in row) {
        const value = row[key];
        normalized[key] = typeof value === 'bigint' ? Number(value) : value;
    }
    return normalized;
}

// Initialize DuckDB
async function initDuckDB() {
    const JSDELIVR_BUNDLES = duckdb.getJsDelivrBundles();
    const bundle = await duckdb.selectBundle(JSDELIVR_BUNDLES);
    const worker = await duckdb.createWorker(bundle.mainWorker);
    const logger = new duckdb.ConsoleLogger();
    const db = new duckdb.AsyncDuckDB(logger, worker);
    await db.instantiate(bundle.mainModule);
    return db;
}

async function loadCSV(path) {
    const response = await fetch(path);
    if (!response.ok) throw new Error(`Failed to load ${path}`);
    return await response.text();
}

// Custom Chart.js plugin for horizontal hover line with value labels
const hoverLinePlugin = {
    id: 'hoverLine',
    afterDraw(chart) {
        const { ctx, chartArea, scales } = chart;
        if (!chart._hoverY) return; // Only draw if hover Y position is set

        const y = chart._hoverY;

        // Ensure y is within chart area
        if (y >= chartArea.top && y <= chartArea.bottom) {
            // Draw horizontal line
            ctx.save();
            ctx.beginPath();
            ctx.strokeStyle = '#666666'; // Gray line
            ctx.lineWidth = 1;
            ctx.setLineDash([5, 5]); // Dashed line
            ctx.moveTo(chartArea.left, y);
            ctx.lineTo(chartArea.right, y);
            ctx.stroke();

            // Calculate values for both Y-axes
            const yRoundsScale = scales.yRounds;
            const yValueScale = scales.yValue;
            const roundsValue = yRoundsScale.getValueForPixel(y);
            const valueValue = yValueScale.getValueForPixel(y);

            // Draw Rounds value label (left Y-axis, above line)
            if (roundsValue !== undefined && !isNaN(roundsValue)) {
                const formattedRounds = Math.round(roundsValue); // Cast to integer
                ctx.font = '12px sans-serif';
                ctx.fillStyle = '#2563eb'; // Match Rounds axis color
                ctx.textAlign = 'left';
                ctx.textBaseline = 'middle';
                ctx.fillText(`Rounds: ${formattedRounds}`, chartArea.left + 5, y - 10); // Above line
            }

            // Draw Value value label (right Y-axis, above line)
            if (valueValue !== undefined && !isNaN(valueValue)) {
                const formattedValue = Math.round(valueValue); // Cast to integer
                ctx.font = '12px sans-serif';
                ctx.fillStyle = '#f11212'; // Match Value axis color
                ctx.textAlign = 'right';
                ctx.textBaseline = 'middle';
                ctx.fillText(`Value: ${formattedValue}`, chartArea.right - 5, y - 10); // Above line
            }

            ctx.restore();
        }
    },
    afterInit(chart) {
        chart.canvas.addEventListener('mousemove', (event) => {
            const rect = chart.canvas.getBoundingClientRect();
            chart._hoverY = event.clientY - rect.top;
            chart.update();
        });
        chart.canvas.addEventListener('mouseout', () => {
            chart._hoverY = null;
            chart.update();
        });
    }
};

async function loadData() {
    let conn;
    try {
        // Check if Chart.js is available
        if (!window.Chart) {
            throw new Error('Chart.js is not loaded. Cannot initialize charts.');
        }
        console.log('Chart.js version:', window.Chart.version);

        const db = await initDuckDB();
        conn = await db.connect();

        // Load CSV
        const csvText = await loadCSV('./data/test/data.csv');

        // Register CSV as a table
        await db.registerFileText('data.csv', csvText);
        await conn.query(`
            CREATE TABLE data AS 
            SELECT 
                time AS time_str,
                strikes,
                length,
                value
            FROM read_csv_auto('data.csv')
        `);

        // Debug: Fetch raw timestamps
        const rawData = await conn.query(`
            SELECT time_str
            FROM data
            ORDER BY time_str
        `);
        console.log('Raw timestamps:', rawData.toArray());

        // Combined query: group by day for rounds and total_value
        const dataQuery = await conn.query(`
            SELECT 
                SUBSTRING(time_str, 1, 10) AS day,
                CAST(SUBSTRING(time_str, 1, 4) AS INTEGER) AS year,
                CAST(SUBSTRING(time_str, 6, 2) AS INTEGER) AS month,
                CAST(COUNT(*) AS DOUBLE) AS rounds,
                CAST(SUM(value) AS DOUBLE) AS total_value
            FROM data
            GROUP BY day, year, month
            ORDER BY day
        `);

        const data = dataQuery.toArray().map(normalizeRow);
        console.log('Combined data:', data);

        // Log max values for debugging
        const maxRounds = Math.max(...data.map(r => r.rounds));
        const maxValue = Math.max(...data.map(r => r.total_value));
        console.log('Max rounds:', maxRounds, 'Max total_value:', maxValue);

        // Register custom plugin
        window.Chart.register(hoverLinePlugin);

        // Initialize combined chart
        const ctx = document.getElementById('combinedChart');
        if (!ctx) throw new Error('Combined chart canvas not found.');
        window.combinedChart = new window.Chart(ctx.getContext('2d'), {
            type: 'line',
            data: {
                labels: [],
                datasets: [
                    {
                        label: 'Rounds',
                        data: [],
                        borderColor: '#2563eb',
                        backgroundColor: 'rgba(37, 99, 235, 0.2)',
                        yAxisID: 'yRounds',
                        fill: true
                    },
                    {
                        label: 'Value',
                        data: [],
                        borderColor: '#f11212',
                        backgroundColor: 'rgba(241, 18, 18, 0.2)',
                        yAxisID: 'yValue',
                        fill: true
                    }
                ]
            },
            options: {
                responsive: true,
                scales: {
                    x: {
                        type: 'category',
                        title: { display: true, text: 'Date' },
                        ticks: {
                            callback: function(value, index, ticks) {
                                const label = this.getLabelForValue(index);
                                const [year, month, day] = label.split('-').map(Number);
                                return new Date(year, month - 1, day).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                            }
                        }
                    },
                    yRounds: {
                        type: 'linear',
                        position: 'left',
                        title: { display: true, text: 'Rounds', color: '#2563eb' },
                        min: 0,
                        max: 120,
                        beginAtZero: true
                    },
                    yValue: {
                        type: 'linear',
                        position: 'right',
                        title: { display: true, text: 'Value', color: '#f11212' },
                        min: 0,
                        max: 1200,
                        beginAtZero: true,
                        grid: { drawOnChartArea: false }
                    }
                },
                plugins: {
                    tooltip: {
                        callbacks: {
                            title: function(tooltipItems) {
                                const label = tooltipItems[0].label;
                                const [year, month, day] = label.split('-').map(Number);
                                return new Date(year, month - 1, day).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
                            },
                            label: function(context) {
                                const datasetLabel = context.dataset.label;
                                const value = context.parsed.y;
                                return `${datasetLabel}: ${value.toLocaleString()}`;
                            }
                        }
                    },
                    legend: {
                        labels: {
                            generateLabels(chart) {
                                const data = chart.data;
                                return data.datasets.map((dataset, i) => {
                                    const total = dataset.data.reduce((sum, val) => sum + val, 0);
                                    const formattedTotal = total.toLocaleString();
                                    return {
                                        text: `${dataset.label}: ${formattedTotal}`,
                                        fillStyle: dataset.backgroundColor,
                                        strokeStyle: dataset.borderColor,
                                        lineWidth: 2,
                                        hidden: !chart.isDatasetVisible(i),
                                        index: i
                                    };
                                });
                            }
                        }
                    }
                }
            }
        });

        // Populate year filter
        const years = [...new Set(data.map(r => r.year))].sort((a, b) => b - a);
        const yearSelect = document.getElementById('yearSelect');
        if (!yearSelect) throw new Error('Year select element not found.');
        years.forEach(year => {
            const option = document.createElement('option');
            option.value = year;
            option.text = year;
            yearSelect.appendChild(option);
        });

        // Event listeners for filters
        const monthSelect = document.getElementById('monthSelect');
        const rangeSelect = document.getElementById('rangeSelect');
        if (!monthSelect || !rangeSelect) throw new Error('Filter select elements not found.');

        function updateChart() {
            const selectedYear = yearSelect.value === 'all' ? null : parseInt(yearSelect.value);
            const selectedMonth = monthSelect.value === 'all' ? null : parseInt(monthSelect.value);
            const range = parseInt(rangeSelect.value) || null;

            let filteredData = data;

            if (range) {
                const latestDate = new Date(Math.max(...data.map(r => new Date(r.day))));
                const startDate = new Date(latestDate);
                startDate.setMonth(startDate.getMonth() - range);
                filteredData = data.filter(r => new Date(r.day) >= startDate);
            } else {
                filteredData = data.filter(r =>
                    (!selectedYear || r.year === selectedYear) &&
                    (!selectedMonth || r.month === selectedMonth)
                );
            }

            // Log filtered data for debugging
            console.log('Filtered data:', filteredData);

            // Update combined chart data
            window.combinedChart.data.labels = filteredData.map(r => r.day);
            window.combinedChart.data.datasets[0].data = filteredData.map(r => Number(r.rounds));
            window.combinedChart.data.datasets[1].data = filteredData.map(r => Number(r.total_value));
            window.combinedChart.update();
        }

        yearSelect.addEventListener('change', updateChart);
        monthSelect.addEventListener('change', updateChart);
        rangeSelect.addEventListener('change', () => {
            if (rangeSelect.value) {
                yearSelect.disabled = true;
                monthSelect.disabled = true;
            } else {
                yearSelect.disabled = false;
                monthSelect.disabled = false;
            }
            updateChart();
        });

        // Tab switching
        document.querySelectorAll('.tab-button').forEach(button => {
            button.addEventListener('click', () => {
                document.querySelectorAll('.tab-button').forEach(b => b.classList.remove('active'));
                document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
                button.classList.add('active');
                const target = document.getElementById(button.dataset.target);
                target.classList.add('active');
                if (window.combinedChart && button.dataset.target === 'roundsTab') {
                    window.combinedChart.resize();
                }
            });
        });

        // Initial chart render
        updateChart();

    } catch (error) {
        console.error('Error loading data or initializing charts:', error);
        alert('Failed to load data or initializing charts. Please check the console for details.');
    } finally {
        if (conn) await conn.close();
    }
}

loadData();