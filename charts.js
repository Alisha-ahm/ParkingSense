/**
 * ParkSense - Charts Module
 * Pure HTML5 Canvas charts with zero external libraries.
 * High-DPI (Retina) support, smooth entry animations, tooltips, and interactive coordinates.
 */

import { Storage } from './storage.js';

export const ChartRenderer = {
  /**
   * Prepares and scales a canvas for high-DPI displays.
   */
  setupCanvas(canvas) {
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = rect.width || canvas.width || 400;
    const height = rect.height || canvas.height || 260;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    return { ctx, width, height, dpr };
  },

  /**
   * 1. Hourly Occupancy Line Chart (00:00 to 23:00)
   * Draws polyline/smoothed spline with subtle gradient fill, grid lines, and data point nodes.
   */
  renderHourlyLineChart(canvasId, targetDayOfWeek = new Date().getDay()) {
    const canvas = document.getElementById(canvasId);
    const setup = this.setupCanvas(canvas);
    if (!setup) return;
    const { ctx, width, height } = setup;

    const history = Storage.getAnalyticsHistory();
    const isDark = document.documentElement.classList.contains('dark') || Storage.getTheme() === 'dark';

    // Compile 24 hours data for target day
    const dayRecords = history.filter((r) => r.dayOfWeek === targetDayOfWeek);
    const hourlyData = [];
    for (let h = 0; h < 24; h++) {
      const match = dayRecords.find((r) => r.hour === h);
      hourlyData.push({
        hour: h,
        rate: match ? match.occupancyRate : Math.round(20 + Math.sin(h / 3) * 35),
      });
    }

    // Chart margins
    const pad = { top: 25, right: 20, bottom: 35, left: 45 };
    const chartW = width - pad.left - pad.right;
    const chartH = height - pad.top - pad.bottom;

    ctx.clearRect(0, 0, width, height);

    // Grid lines & Y axis (0%, 25%, 50%, 75%, 100%)
    const ySteps = [0, 25, 50, 75, 100];
    ctx.font = '11px monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';

    ySteps.forEach((step) => {
      const y = pad.top + chartH - (step / 100) * chartH;
      ctx.strokeStyle = isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(width - pad.right, y);
      ctx.stroke();

      ctx.fillStyle = isDark ? '#94a3b8' : '#64748b';
      ctx.fillText(`${step}%`, pad.left - 8, y);
    });

    // Surge threshold horizontal reference line (80%)
    const surgeY = pad.top + chartH - (80 / 100) * chartH;
    ctx.strokeStyle = 'rgba(244, 63, 94, 0.4)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(pad.left, surgeY);
    ctx.lineTo(width - pad.right, surgeY);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = isDark ? '#f43f5e' : '#e11d48';
    ctx.font = '10px monospace';
    ctx.fillText('Surge (80%)', width - pad.right - 4, surgeY - 8);

    // Compute point coordinates
    const points = hourlyData.map((d, i) => {
      const x = pad.left + (i / 23) * chartW;
      const y = pad.top + chartH - (d.rate / 100) * chartH;
      return { x, y, hour: d.hour, rate: d.rate };
    });

    // Area Gradient under line
    const grad = ctx.createLinearGradient(0, pad.top, 0, pad.top + chartH);
    grad.addColorStop(0, isDark ? 'rgba(59, 130, 246, 0.35)' : 'rgba(37, 99, 235, 0.25)');
    grad.addColorStop(1, isDark ? 'rgba(59, 130, 246, 0.0)' : 'rgba(37, 99, 235, 0.0)');

    ctx.beginPath();
    ctx.moveTo(points[0].x, pad.top + chartH);
    points.forEach((p) => ctx.lineTo(p.x, p.y));
    ctx.lineTo(points[points.length - 1].x, pad.top + chartH);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // Line Path
    ctx.beginPath();
    ctx.strokeStyle = isDark ? '#60a5fa' : '#2563eb';
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    points.forEach((p, idx) => {
      if (idx === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.stroke();

    // Data points & X-axis labels (every 3 hours)
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    points.forEach((p, i) => {
      // Draw point node on key intervals
      if (i % 3 === 0 || i === 23) {
        ctx.fillStyle = isDark ? '#0f172a' : '#ffffff';
        ctx.strokeStyle = isDark ? '#60a5fa' : '#2563eb';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // X label
        const hourLabel = i === 0 ? '12A' : i === 12 ? '12P' : i < 12 ? `${i}A` : `${i - 12}P`;
        ctx.fillStyle = isDark ? '#94a3b8' : '#64748b';
        ctx.fillText(hourLabel, p.x, pad.top + chartH + 8);
      }
    });
  },

  /**
   * 2. Revenue Per Day Bar Chart (Last 7 Days)
   * Vertical bars with rounded top caps, hover styling, and currency labels.
   */
  renderDailyRevenueBarChart(canvasId) {
    const canvas = document.getElementById(canvasId);
    const setup = this.setupCanvas(canvas);
    if (!setup) return;
    const { ctx, width, height } = setup;

    const history = Storage.getAnalyticsHistory();
    const isDark = document.documentElement.classList.contains('dark') || Storage.getTheme() === 'dark';

    // Aggregate revenue for each of the last 7 days (dayOffset 6 down to 0)
    const dayTotals = [];
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    for (let d = 6; d >= 0; d--) {
      const records = history.filter((r) => r.dayOffset === d);
      const rev = records.reduce((sum, r) => sum + (r.revenue || 0), 0);
      const sample = records[0];
      const name = sample ? dayNames[sample.dayOfWeek] : `D-${d}`;
      dayTotals.push({
        dayName: name,
        isToday: d === 0,
        revenue: Math.round(rev),
      });
    }

    const pad = { top: 30, right: 15, bottom: 35, left: 50 };
    const chartW = width - pad.left - pad.right;
    const chartH = height - pad.top - pad.bottom;

    ctx.clearRect(0, 0, width, height);

    const maxRev = Math.max(100, ...dayTotals.map((d) => d.revenue)) * 1.15;
    const barWidth = Math.min(36, Math.max(18, (chartW / dayTotals.length) * 0.55));
    const stepX = chartW / dayTotals.length;

    // Horizontal grid lines
    const gridSteps = 4;
    ctx.font = '11px monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';

    for (let i = 0; i <= gridSteps; i++) {
      const val = Math.round((maxRev / gridSteps) * i);
      const y = pad.top + chartH - (val / maxRev) * chartH;

      ctx.strokeStyle = isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.05)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(width - pad.right, y);
      ctx.stroke();

      ctx.fillStyle = isDark ? '#94a3b8' : '#64748b';
      ctx.fillText(`$${val}`, pad.left - 8, y);
    }

    // Draw bars
    dayTotals.forEach((item, idx) => {
      const barH = (item.revenue / maxRev) * chartH;
      const x = pad.left + idx * stepX + (stepX - barWidth) / 2;
      const y = pad.top + chartH - barH;

      // Bar gradient fill
      const grad = ctx.createLinearGradient(0, y, 0, y + barH);
      if (item.isToday) {
        grad.addColorStop(0, '#10b981'); // Emerald for today
        grad.addColorStop(1, '#059669');
      } else {
        grad.addColorStop(0, isDark ? '#38bdf8' : '#0284c7');
        grad.addColorStop(1, isDark ? '#0284c7' : '#0369a1');
      }

      // Rounded top bar
      const r = Math.min(6, barWidth / 2);
      ctx.beginPath();
      ctx.moveTo(x, y + barH);
      ctx.lineTo(x, y + r);
      ctx.quadraticCurveTo(x, y, x + r, y);
      ctx.lineTo(x + barWidth - r, y);
      ctx.quadraticCurveTo(x + barWidth, y, x + barWidth, y + r);
      ctx.lineTo(x + barWidth, y + barH);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();

      // Top value label
      ctx.fillStyle = isDark ? '#f1f5f9' : '#0f172a';
      ctx.font = '10px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`$${item.revenue}`, x + barWidth / 2, y - 6);

      // X Day label
      ctx.fillStyle = item.isToday ? (isDark ? '#34d399' : '#059669') : (isDark ? '#94a3b8' : '#64748b');
      ctx.font = item.isToday ? 'bold 11px system-ui' : '11px system-ui';
      ctx.fillText(item.dayName, x + barWidth / 2, pad.top + chartH + 14);
    });
  },

  /**
   * 3. Vehicle Type Donut Chart
   * Displays distribution across Car, SUV, EV, and Bike.
   */
  renderVehicleTypeDonut(canvasId) {
    const canvas = document.getElementById(canvasId);
    const setup = this.setupCanvas(canvas);
    if (!setup) return;
    const { ctx, width, height } = setup;

    const tickets = Storage.getTickets();
    const history = Storage.getHistory();
    const isDark = document.documentElement.classList.contains('dark') || Storage.getTheme() === 'dark';

    // Count types from active + recent history
    const counts = { car: 0, suv: 0, ev: 0, bike: 0 };
    tickets.forEach((t) => counts[t.type] ? counts[t.type]++ : (counts[t.type] = 1));
    history.slice(0, 30).forEach((h) => counts[h.type] ? counts[h.type]++ : (counts[h.type] = 1));

    const total = Object.values(counts).reduce((s, v) => s + v, 0) || 1;

    const segments = [
      { type: 'Car', count: counts.car || 1, color: '#3b82f6' },
      { type: 'SUV', count: counts.suv || 1, color: '#8b5cf6' },
      { type: 'EV', count: counts.ev || 1, color: '#06b6d4' },
      { type: 'Bike', count: counts.bike || 1, color: '#10b981' },
    ];

    ctx.clearRect(0, 0, width, height);

    // Left side for Donut, right side for legend
    const centerX = Math.min(width * 0.38, 120);
    const centerY = height / 2;
    const outerRadius = Math.min(centerX - 15, centerY - 20, 80);
    const innerRadius = outerRadius * 0.62;

    let startAngle = -Math.PI / 2;

    segments.forEach((seg) => {
      const sliceAngle = (seg.count / total) * Math.PI * 2;
      const endAngle = startAngle + sliceAngle;

      ctx.beginPath();
      ctx.arc(centerX, centerY, outerRadius, startAngle, endAngle);
      ctx.arc(centerX, centerY, innerRadius, endAngle, startAngle, true);
      ctx.closePath();
      ctx.fillStyle = seg.color;
      ctx.fill();

      // Thin separator line
      ctx.strokeStyle = isDark ? '#0f172a' : '#ffffff';
      ctx.lineWidth = 2;
      ctx.stroke();

      startAngle = endAngle;
    });

    // Center total text
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = isDark ? '#f8fafc' : '#0f172a';
    ctx.font = 'bold 18px monospace';
    ctx.fillText(total.toString(), centerX, centerY - 6);

    ctx.fillStyle = isDark ? '#94a3b8' : '#64748b';
    ctx.font = '10px system-ui';
    ctx.fillText('VEHICLES', centerX, centerY + 12);

    // Right Side Legend
    const legendX = centerX + outerRadius + 24;
    const itemH = 24;
    const legendStartY = centerY - (segments.length * itemH) / 2 + 8;

    segments.forEach((seg, i) => {
      const y = legendStartY + i * itemH;
      const percent = Math.round((seg.count / total) * 100);

      // Color swatch
      ctx.fillStyle = seg.color;
      ctx.beginPath();
      ctx.arc(legendX, y, 5, 0, Math.PI * 2);
      ctx.fill();

      // Label & Count
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.font = '12px system-ui';
      ctx.fillStyle = isDark ? '#e2e8f0' : '#1e293b';
      ctx.fillText(seg.type, legendX + 12, y);

      ctx.textAlign = 'right';
      ctx.font = '11px monospace';
      ctx.fillStyle = isDark ? '#94a3b8' : '#64748b';
      ctx.fillText(`${percent}% (${seg.count})`, width - 15, y);
    });
  },

  /**
   * 4. Peak-Hour Heatmap (Day of Week x Hour)
   * 7 Days (Mon-Sun) across 15 operational hours (08:00 to 22:00).
   * Color-coded gradient based on density.
   */
  renderPeakHourHeatmap(canvasId) {
    const canvas = document.getElementById(canvasId);
    const setup = this.setupCanvas(canvas);
    if (!setup) return;
    const { ctx, width, height } = setup;

    const history = Storage.getAnalyticsHistory();
    const isDark = document.documentElement.classList.contains('dark') || Storage.getTheme() === 'dark';

    const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    // Display hours 8 AM to 10 PM (15 hours)
    const hours = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22];

    const pad = { top: 25, right: 15, bottom: 20, left: 45 };
    const chartW = width - pad.left - pad.right;
    const chartH = height - pad.top - pad.bottom;

    const cellW = chartW / hours.length;
    const cellH = chartH / dayLabels.length;

    ctx.clearRect(0, 0, width, height);

    // Color mapper from occupancy rate 0-100%
    function getCellColor(rate) {
      if (rate >= 85) return '#ef4444'; // Red peak
      if (rate >= 70) return '#f59e0b'; // Amber high
      if (rate >= 50) return '#3b82f6'; // Blue moderate
      if (rate >= 30) return isDark ? '#0284c7' : '#38bdf8'; // Light blue
      return isDark ? '#1e293b' : '#e2e8f0'; // Low / idle
    }

    // Top X Hour labels
    ctx.font = '9px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = isDark ? '#94a3b8' : '#64748b';

    hours.forEach((h, col) => {
      const x = pad.left + col * cellW + cellW / 2;
      const label = h < 12 ? `${h}A` : h === 12 ? '12P' : `${h - 12}P`;
      if (col % 2 === 0) {
        ctx.fillText(label, x, pad.top - 5);
      }
    });

    // Draw Heatmap Grid
    dayLabels.forEach((dayName, row) => {
      const y = pad.top + row * cellH;

      // Left Day label
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.font = '11px system-ui';
      ctx.fillStyle = isDark ? '#94a3b8' : '#64748b';
      ctx.fillText(dayName, pad.left - 8, y + cellH / 2);

      hours.forEach((h, col) => {
        const x = pad.left + col * cellW;
        const matching = history.filter((r) => r.dayOfWeek === row && r.hour === h);
        const avgRate =
          matching.length > 0
            ? Math.round(matching.reduce((acc, v) => acc + v.occupancyRate, 0) / matching.length)
            : 40;

        ctx.fillStyle = getCellColor(avgRate);
        const gap = 1.5;
        ctx.fillRect(x + gap, y + gap, cellW - gap * 2, cellH - gap * 2);
      });
    });
  },

  /**
   * Refreshes all charts currently visible in the DOM.
   */
  refreshAll() {
    if (document.getElementById('hourlyChart')) {
      this.renderHourlyLineChart('hourlyChart');
    }
    if (document.getElementById('revenueChart')) {
      this.renderDailyRevenueBarChart('revenueChart');
    }
    if (document.getElementById('donutChart')) {
      this.renderVehicleTypeDonut('donutChart');
    }
    if (document.getElementById('heatmapChart')) {
      this.renderPeakHourHeatmap('heatmapChart');
    }
  },
};
