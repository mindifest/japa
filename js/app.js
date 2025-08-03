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
            const roundsValue = yRoundsScale ? yRoundsScale.getValueForPixel(y) : undefined;
            const valueValue = yValueScale ? yValueScale.getValueForPixel(y) : undefined;

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
    let db;
    try {
        // Check if Chart.js is available
        if (!window.Chart) {
            throw new Error('Chart.js is not loaded. Cannot initialize charts.');
        }
        console.log('Chart.js version:', window.Chart.version);

        db = await initDuckDB();
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

        // Combined query for Rounds & Value chart: group by day
        const dailyDataQuery = await conn.query(`
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

        const dailyData = dailyDataQuery.toArray().map(normalizeRow);
        console.log('Daily data:', dailyData);

        // Log max values for debugging
        const maxRounds = Math.max(...dailyData.map(r => r.rounds));
        const maxValue = Math.max(...dailyData.map(r => r.total_value));
        console.log('Max rounds:', maxRounds, 'Max total_value:', maxValue);

        // Register custom plugin
        window.Chart.register(hoverLinePlugin);

        // Initialize combined chart (Rounds & Value)
        const ctxCombined = document.getElementById('combinedChart');
        if (!ctxCombined) throw new Error('Combined chart canvas not found.');
        window.combinedChart = new window.Chart(ctxCombined.getContext('2d'), {
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

        // Initialize hourly chart (Chanting Times)
        const ctxHourly = document.getElementById('hourlyChart');
        if (!ctxHourly) throw new Error('Hourly chart canvas not found.');
        window.hourlyChart = new window.Chart(ctxHourly.getContext('2d'), {
            type: 'bar',
            data: {
                labels: Array.from({ length: 24 }, (_, i) => {
                    const hour = i % 12 || 12;
                    const period = i < 12 ? 'am' : 'pm';
                    return `${hour}${period}`;
                }),
                datasets: [{
                    label: 'Rounds per Hour',
                    data: Array(24).fill(0),
                    backgroundColor: '#16a34a',
                    borderColor: '#15803d',
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                scales: {
                    x: {
                        type: 'category',
                        title: { display: true, text: 'Hour of Day' }
                    },
                    y: {
                        type: 'linear',
                        title: { display: true, text: 'Rounds', color: '#16a34a' },
                        min: 0,
                        beginAtZero: true
                    }
                },
                plugins: {
                    tooltip: {
                        callbacks: {
                            title: function(tooltipItems) {
                                return `Hour: ${tooltipItems[0].label}`;
                            },
                            label: function(context) {
                                const value = context.parsed.y;
                                return `Rounds: ${value.toLocaleString()}`;
                            }
                        }
                    },
                    legend: {
                        labels: {
                            generateLabels(chart) {
                                const data = chart.data;
                                return data.datasets.map((dataset, i) => ({
                                    text: dataset.label, // Static label without total
                                    fillStyle: dataset.backgroundColor,
                                    strokeStyle: dataset.borderColor,
                                    lineWidth: 1,
                                    hidden: !chart.isDatasetVisible(i),
                                    index: i
                                }));
                            }
                        }
                    }
                }
            }
        });

        // Populate year filter
        const years = [...new Set(dailyData.map(r => r.year))].sort((a, b) => b - a);
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

        async function updateCharts() {
            const selectedYear = yearSelect.value === 'all' ? null : parseInt(yearSelect.value);
            const selectedMonth = monthSelect.value === 'all' ? null : parseInt(monthSelect.value);
            const range = parseInt(rangeSelect.value) || null;

            // Filter daily data for Rounds & Value chart
            let filteredDailyData = dailyData;
            if (range) {
                const latestDate = new Date(Math.max(...dailyData.map(r => new Date(r.day))));
                const startDate = new Date(latestDate);
                startDate.setMonth(startDate.getMonth() - range);
                filteredDailyData = dailyData.filter(r => new Date(r.day) >= startDate);
            } else {
                filteredDailyData = dailyData.filter(r =>
                    (!selectedYear || r.year === selectedYear) &&
                    (!selectedMonth || r.month === selectedMonth)
                );
            }

            // Log filtered daily data
            console.log('Filtered daily data:', filteredDailyData);

            // Update combined chart
            window.combinedChart.data.labels = filteredDailyData.map(r => r.day);
            window.combinedChart.data.datasets[0].data = filteredDailyData.map(r => Number(r.rounds));
            window.combinedChart.data.datasets[1].data = filteredDailyData.map(r => Number(r.total_value));
            window.combinedChart.update();

            // Query for hourly data with filters
            let hourlyQuery = `
                SELECT 
                    CAST(SUBSTRING(time_str, 12, 2) AS INTEGER) AS hour,
                    CAST(COUNT(*) AS DOUBLE) AS rounds
                FROM data
            `;
            if (range || selectedYear || selectedMonth) {
                hourlyQuery += ' WHERE ';
                const conditions = [];
                if (range) {
                    const latestDate = new Date(Math.max(...dailyData.map(r => new Date(r.day))));
                    const startDate = new Date(latestDate);
                    startDate.setMonth(startDate.getMonth() - range);
                    conditions.push(`time_str >= '${startDate.toISOString().slice(0, 10)}'`);
                }
                if (selectedYear) conditions.push(`SUBSTRING(time_str, 1, 4) = '${selectedYear}'`);
                if (selectedMonth) conditions.push(`SUBSTRING(time_str, 6, 2) = '${selectedMonth.toString().padStart(2, '0')}'`);
                hourlyQuery += conditions.join(' AND ');
            }
            hourlyQuery += `
                GROUP BY hour
                ORDER BY hour
            `;

            const hourlyDataResult = await conn.query(hourlyQuery);
            const hourlyData = hourlyDataResult.toArray().map(normalizeRow);
            console.log('Hourly data:', hourlyData);

            // Prepare hourly chart data
            const hourlyRounds = Array(24).fill(0);
            hourlyData.forEach(row => {
                if (row.hour >= 0 && row.hour < 24) {
                    hourlyRounds[row.hour] = row.rounds;
                }
            });

            // Update hourly chart
            window.hourlyChart.data.datasets[0].data = hourlyRounds;
            window.hourlyChart.update();
        }

        yearSelect.addEventListener('change', updateCharts);
        monthSelect.addEventListener('change', updateCharts);
        rangeSelect.addEventListener('change', () => {
            if (rangeSelect.value) {
                yearSelect.disabled = true;
                monthSelect.disabled = true;
            } else {
                yearSelect.disabled = false;
                monthSelect.disabled = false;
            }
            updateCharts();
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
                } else if (window.hourlyChart && button.dataset.target === 'chantingTimesTab') {
                    window.hourlyChart.resize();
                }
            });
        });

        // Initial chart render
        await updateCharts();

    } catch (error) {
        console.error('Error loading data or initializing charts:', error);
        alert('Failed to load data or initializing charts. Please check the console for details.');
    } finally {
        // Keep connection open for updateCharts
    }

    return { db, conn };
}

loadData();