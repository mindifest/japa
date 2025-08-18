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

async function loadCSV() {
    // Use test data only if ?data=test, otherwise use prod
    const params = new URLSearchParams(window.location.search);
    const dataSource = params.get('data') === 'test' ? './data/test/data.csv' : './data/data.csv';
    console.log('Loading data from:', dataSource);

    const response = await fetch(dataSource);
    if (!response.ok) throw new Error(`Failed to load ${dataSource}`);
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

            // Calculate Rounds value
            const yRoundsScale = scales.y;
            const roundsValue = yRoundsScale ? yRoundsScale.getValueForPixel(y) : undefined;

            // Draw Rounds value label (left Y-axis, above line)
            if (roundsValue !== undefined && !isNaN(roundsValue)) {
                const formattedRounds = Math.round(roundsValue); // Cast to integer
                ctx.font = '12px sans-serif';
                ctx.fillStyle = '#2563eb'; // Match Rounds axis color
                ctx.textAlign = 'left';
                ctx.textBaseline = 'middle';
                ctx.fillText(`Rounds: ${formattedRounds}`, chartArea.left + 5, y - 10); // Above line
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
        const csvText = await loadCSV();

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

        // Initial daily query for year population and default chart
        let dailyDataQuery = await conn.query(`
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

        // Log max values for debugging
        const dailyData = dailyDataQuery.toArray().map(normalizeRow);
        const maxRounds = Math.max(...dailyData.map(r => r.rounds));
        const maxValue = Math.max(...dailyData.map(r => r.total_value));
        console.log('Max rounds:', maxRounds, 'Max total_value:', maxValue);

        // Register custom plugin
        window.Chart.register(hoverLinePlugin);

        // Initialize combined chart (Rounds only)
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
                        totalValues: [], // Initialize totalValues
                        borderColor: '#2563eb',
                        backgroundColor: 'rgba(37, 99, 235, 0.2)',
                        yAxisID: 'y',
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
                                if (label.includes('W')) {
                                    // Weekly label: "YYYY-Www" (e.g., "2023-W01")
                                    const [year, week] = label.split('-W');
                                    const weekStart = new Date(year, 0, 1 + (parseInt(week) - 1) * 7);
                                    // Adjust to Monday, then get end of week (Sunday)
                                    weekStart.setDate(weekStart.getDate() - (weekStart.getDay() || 7) + 1);
                                    const weekEnd = new Date(weekStart);
                                    weekEnd.setDate(weekStart.getDate() + 6);
                                    return weekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                                } else {
                                    // Daily label: "YYYY-MM-DD"
                                    const [year, month, day] = label.split('-').map(Number);
                                    return new Date(year, month - 1, day).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                                }
                            }
                        }
                    },
                    y: {
                        type: 'linear',
                        position: 'left',
                        title: { display: true, text: 'Rounds', color: '#2563eb' },
                        min: 0,
                        beginAtZero: true
                    }
                },
                plugins: {
                    tooltip: {
                        callbacks: {
                            title: function(tooltipItems) {
                                const label = tooltipItems[0].label;
                                if (label.includes('W')) {
                                    // Weekly tooltip
                                    const [year, week] = label.split('-W');
                                    const weekStart = new Date(year, 0, 1 + (parseInt(week) - 1) * 7);
                                    weekStart.setDate(weekStart.getDate() - (weekStart.getDay() || 7) + 1);
                                    return `Week of ${weekStart.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`;
                                } else {
                                    // Daily tooltip
                                    const [year, month, day] = label.split('-').map(Number);
                                    return new Date(year, month - 1, day).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
                                }
                            },
                            label: function(context) {
                                const index = context.dataIndex;
                                const dataset = context.dataset;
                                const rounds = dataset.data[index];
                                const value = dataset.totalValues[index] || 0; // Fallback to 0
                                return [
                                    `Rounds: ${Math.round(rounds).toLocaleString()}`,
                                    `Value: ${Math.round(value).toLocaleString()}`
                                ];
                            }
                        }
                    },
                    legend: {
                        labels: {
                            generateLabels(chart) {
                                const data = chart.data;
                                const dataset = data.datasets[0];
                                const totalRounds = dataset.data.reduce((sum, val) => sum + val, 0) || 0;
                                const totalValue = dataset.totalValues.reduce((sum, val) => sum + val, 0) || 0;
                                const formattedRounds = totalRounds.toLocaleString();
                                const formattedValue = totalValue.toLocaleString();
                                return [{
                                    text: `Rounds: ${formattedRounds} (value: ${formattedValue})`,
                                    fillStyle: dataset.backgroundColor,
                                    strokeStyle: dataset.borderColor,
                                    lineWidth: 2,
                                    hidden: !chart.isDatasetVisible(0),
                                    index: 0
                                }];
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
                                    text: dataset.label,
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
        // Default to current year (2025)
        yearSelect.value = '2025';

        // Define updateCharts before event listeners
        async function updateCharts() {
            const selectedYear = parseInt(yearSelect.value);
            const selectedMonth = monthSelect.value === 'all' ? null : parseInt(monthSelect.value);
            const range = parseInt(rangeSelect.value) || null;

            // Determine if weekly aggregation is needed
            const useWeekly = !range && !selectedMonth; // Year with All Months

            // Query for combined chart data
            let dataQuery = dailyDataQuery;
            if (useWeekly) {
                let weeklyQuery = `
                    SELECT 
                        STRFTIME(time_str, '%Y-W%W') AS week,
                        CAST(SUBSTRING(time_str, 1, 4) AS INTEGER) AS year,
                        CAST(COUNT(*) AS DOUBLE) AS rounds,
                        CAST(SUM(value) AS DOUBLE) AS total_value
                    FROM data
                    WHERE SUBSTRING(time_str, 1, 4) = '${selectedYear}'
                    GROUP BY week, year
                    ORDER BY week
                `;
                dataQuery = await conn.query(weeklyQuery);
            }

            let filteredDailyData = dataQuery.toArray().map(normalizeRow);
            console.log('Combined chart data:', filteredDailyData);

            // Apply filters for daily data
            if (!useWeekly) {
                if (range) {
                    const latestDate = new Date(Math.max(...filteredDailyData.map(r => new Date(r.day))));
                    const startDate = new Date(latestDate);
                    startDate.setMonth(startDate.getMonth() - range);
                    filteredDailyData = filteredDailyData.filter(r => new Date(r.day) >= startDate);
                } else {
                    filteredDailyData = filteredDailyData.filter(r =>
                        r.year === selectedYear &&
                        (!selectedMonth || r.month === selectedMonth)
                    );
                }
            }

            // Log filtered data
            console.log('Filtered combined chart data:', filteredDailyData);

            // Dynamic Y-axis scaling
            const maxRounds = Math.max(...filteredDailyData.map(r => r.rounds), 1); // Avoid 0 max
            window.combinedChart.options.scales.y.max = Math.ceil(maxRounds * 1.2);
            console.log('Dynamic Y-axis limit:', { maxRounds: window.combinedChart.options.scales.y.max });

            // Update combined chart
            window.combinedChart.data.labels = useWeekly
                ? filteredDailyData.map(r => r.week)
                : filteredDailyData.map(r => r.day);
            window.combinedChart.data.datasets[0].data = filteredDailyData.map(r => Number(r.rounds));
            window.combinedChart.data.datasets[0].totalValues = filteredDailyData.map(r => Number(r.total_value));
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
                    const rawData = dailyDataQuery.toArray();
                    const latestDate = new Date(Math.max(...rawData.map(r => new Date(r.day))));
                    const startDate = new Date(latestDate);
                    startDate.setMonth(startDate.getMonth() - range);
                    conditions.push(`time_str >= '${startDate.toISOString().slice(0, 10)}'`);
                }
                conditions.push(`SUBSTRING(time_str, 1, 4) = '${selectedYear}'`);
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

        // Event listeners for filters
        const monthSelect = document.getElementById('monthSelect');
        const rangeSelect = document.getElementById('rangeSelect');
        if (!monthSelect || !rangeSelect) throw new Error('Filter select elements not found.');

        // Enable/disable monthSelect based on yearSelect
        yearSelect.addEventListener('change', () => {
            monthSelect.disabled = false; // Always enabled since no "All Years"
            monthSelect.value = 'all'; // Reset to All Months
            updateCharts();
        });

        monthSelect.addEventListener('change', updateCharts);

        rangeSelect.addEventListener('change', () => {
            if (rangeSelect.value) {
                yearSelect.disabled = true;
                monthSelect.disabled = true;
                monthSelect.value = 'all'; // Reset to All Months
            } else {
                yearSelect.disabled = false;
                monthSelect.disabled = false; // Always enabled
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