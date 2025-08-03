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

async function loadData() {
    let conn;
    try {
        // Check if Chart.js is available
        if (!window.Chart) {
            throw new Error('Chart.js is not loaded. Cannot initialize charts.');
        }

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

        // Query data: group by day and count records
        const roundsData = await conn.query(`
            SELECT 
                SUBSTRING(time_str, 1, 10) AS day,
                CAST(SUBSTRING(time_str, 1, 4) AS INTEGER) AS year,
                CAST(SUBSTRING(time_str, 6, 2) AS INTEGER) AS month,
                CAST(COUNT(*) AS DOUBLE) AS rounds
            FROM data
            GROUP BY day, year, month
            ORDER BY day
        `);

        const rounds = roundsData.toArray().map(normalizeRow);
        console.log('Rounds data:', rounds);

        // Query data: group by day and sum value
        const valueData = await conn.query(`
            SELECT 
                SUBSTRING(time_str, 1, 10) AS day,
                CAST(SUBSTRING(time_str, 1, 4) AS INTEGER) AS year,
                CAST(SUBSTRING(time_str, 6, 2) AS INTEGER) AS month,
                CAST(SUM(value) AS DOUBLE) AS total_value
            FROM data
            GROUP BY day, year, month
            ORDER BY day
        `);

        const value = valueData.toArray().map(normalizeRow);
        console.log('Value data:', value);

        // Initialize charts
        const ctx1 = document.getElementById('roundsChart');
        if (!ctx1) throw new Error('Rounds chart canvas not found.');
        window.roundsChart = new window.Chart(ctx1.getContext('2d'), {
            type: 'line',
            data: {
                labels: [],
                datasets: [{
                    label: 'Rounds',
                    data: [],
                    borderColor: '#2563eb',
                    backgroundColor: 'rgba(37, 99, 235, 0.2)',
                    fill: true
                }]
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
                    y: {
                        type: 'linear',
                        display: true,
                        position: 'left',
                        title: { display: true, text: 'Rounds' },
                        beginAtZero: true
                    }
                },
                plugins: {
                    tooltip: {
                        callbacks: {
                            title: function(tooltipItems) {
                                const label = tooltipItems[0].label;
                                const [year, month, day] = label.split('-').map(Number);
                                return new Date(year, month - 1, day).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
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

        const ctx2 = document.getElementById('valueChart');
        if (!ctx2) throw new Error('Value chart canvas not found.');
        window.valueChart = new window.Chart(ctx2.getContext('2d'), {
            type: 'line',
            data: {
                labels: [],
                datasets: [{
                    label: 'Value',
                    data: [],
                    borderColor: '#f11212',
                    backgroundColor: 'rgba(241, 18, 18, 0.2)',
                    fill: true
                }]
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
                    y: {
                        type: 'linear',
                        display: true,
                        position: 'left',
                        title: { display: true, text: 'Value' },
                        beginAtZero: true
                    }
                },
                plugins: {
                    tooltip: {
                        callbacks: {
                            title: function(tooltipItems) {
                                const label = tooltipItems[0].label;
                                const [year, month, day] = label.split('-').map(Number);
                                return new Date(year, month - 1, day).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
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
        const years = [...new Set(rounds.map(r => r.year))].sort((a, b) => b - a);
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

            let filteredRounds = rounds;
            let filteredValues = value;

            if (range) {
                const latestDate = new Date(Math.max(...rounds.map(r => new Date(r.day))));
                const startDate = new Date(latestDate);
                startDate.setMonth(startDate.getMonth() - range);
                filteredRounds = rounds.filter(r => new Date(r.day) >= startDate);
                filteredValues = value.filter(r => new Date(r.day) >= startDate);
            } else {
                filteredRounds = rounds.filter(r =>
                    (!selectedYear || r.year === selectedYear) &&
                    (!selectedMonth || r.month === selectedMonth)
                );
                filteredValues = value.filter(r =>
                    (!selectedYear || r.year === selectedYear) &&
                    (!selectedMonth || r.month === selectedMonth)
                );
            }

            // Log filtered data for debugging
            console.log('Filtered rounds:', filteredRounds);
            console.log('Filtered values:', filteredValues);

            // Update rounds chart data
            window.roundsChart.data.labels = filteredRounds.map(r => r.day);
            window.roundsChart.data.datasets[0].data = filteredRounds.map(r => Number(r.rounds));
            window.roundsChart.update();

            // Update value chart data
            window.valueChart.data.labels = filteredValues.map(r => r.day);
            window.valueChart.data.datasets[0].data = filteredValues.map(r => Number(r.total_value));
            window.valueChart.update();
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
                if (window.roundsChart && button.dataset.target === 'roundsTab') {
                    window.roundsChart.resize();
                } else if (window.valueChart && button.dataset.target === 'valueTab') {
                    window.valueChart.resize();
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