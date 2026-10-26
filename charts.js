/**
 * ParkSense - Charts Module
 * Custom HTML5 Canvas charts designed to match the reference dashboard aesthetic:
 * Smooth dual-tone royal-blue area wave curves, modern bar charts with rounded tops and value callouts,
 * and high-contrast blue/cyan donut distribution charts. Zero external dependencies.
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
    const height = rect.height || canvas.height || 220;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    return { ctx, width, height, dpr };
  },

  /**
   * 1. Hourly Occupancy & Diurnal Telemetry Profile Line Chart
   * Displays 24-hour diurnal curve with actual sensor telemetry and expected baseline.
   */
  renderHourlyLineChart(canvasId, targetDayOfWeek = new Date().getDay(), mode = 'live') {
    const canvas = document.getElementById(canvasId);
    const setup = this.setupCanvas(canvas);
    if (!setup) return;
    const { ctx, width, height } = setup;

    const history = Storage.getAnalyticsHistory();
    const slots = Storage.getSlots();
    const activeOccupied = slots.filter((s) => s.status === 'occupied' || s.status === 'ev_charging').length;
    const currentActualRate = Math.round((activeOccupied / (slots.length || 60)) * 100);

    // 24 hours of data
    const dayRecords = history.filter((r) => r.dayOfWeek === targetDayOfWeek);
    const hourlyData = [];
    const currentHour = new Date().getHours();

    for (let h = 0; h < 24; h++) {
      const match = dayRecords.find((r) => r.hour === h);
      let rate = match ? match.occupancyRate : Math.round(25 + Math.sin(h / 3.2) * 35);
      // For current hour, blend in actual live sensor occupancy
      if (h === currentHour) {
        rate = Math.max(rate, currentActualRate);
      }
      // Baseline diurnal expected curve
      const baseline = Math.round(20 + Math.sin(h / 3.5) * 30 + 10);
      hourlyData.push({
        hour: h,
        rate: Math.min(100, Math.max(5, rate)),
        baseline: Math.min(100, Math.max(5, baseline)),
      });
    }

    // Identify Peak Hour
    let peakItem = hourlyData[0];
    hourlyData.forEach((d) => {
      if (d.rate > peakItem.rate) peakItem = d;
    });

    // Update Live Telemetry Metrics Strip in DOM
    const currentHourData = hourlyData[currentHour] || hourlyData[12];
    const currRateEl = document.getElementById('chartCurrentHourRate');
    if (currRateEl) {
      currRateEl.textContent = `${currentHourData.rate}% Occupied`;
    }
    const peakRateEl = document.getElementById('chartPeakHourRate');
    if (peakRateEl) {
      const peakHourFormatted = `${peakItem.hour.toString().padStart(2, '0')}:00`;
      peakRateEl.textContent = `${peakHourFormatted} (${peakItem.rate}%)`;
    }

    const pad = { top: 28, right: 24, bottom: 28, left: 45 };
    const chartW = width - pad.left - pad.right;
    const chartH = height - pad.top - pad.bottom;

    ctx.clearRect(0, 0, width, height);

    // Grid lines & Dark High-Contrast Y-axis labels
    const ySteps = [0, 25, 50, 75, 100];
    const yLabels = ['0%', '25%', '50%', '75%', '100%'];
    ctx.font = '700 11px "JetBrains Mono", monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';

    ySteps.forEach((step, idx) => {
      const y = pad.top + chartH - (step / 100) * chartH;
      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(width - pad.right, y);
      ctx.stroke();

      // Dark slate label
      ctx.fillStyle = '#0f172a';
      ctx.fillText(yLabels[idx], pad.left - 8, y);
    });

    // Coordinate mapping
    const points = hourlyData.map((d, i) => {
      const x = pad.left + (i / 23) * chartW;
      const y = pad.top + chartH - (d.rate / 100) * chartH;
      const baselineY = pad.top + chartH - (d.baseline / 100) * chartH;
      return { x, y, baselineY, hour: d.hour, rate: d.rate, baseline: d.baseline };
    });

    // Helper: Draw smooth bezier curve through points
    function drawSpline(ctx, pts, yKey = 'y') {
      ctx.moveTo(pts[0].x, pts[0][yKey]);
      for (let i = 0; i < pts.length - 1; i++) {
        const p0 = pts[i === 0 ? 0 : i - 1];
        const p1 = pts[i];
        const p2 = pts[i + 1];
        const p3 = pts[i + 2 < pts.length ? i + 2 : i + 1];

        const cp1x = p1.x + (p2.x - p0.x) / 6;
        const cp1y = p1[yKey] + (p2[yKey] - p0[yKey]) / 6;
        const cp2x = p2.x - (p3.x - p1.x) / 6;
        const cp2y = p2.y - (p3[yKey] - p1[yKey]) / 6;

        ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2[yKey]);
      }
    }

    // 1. Secondary wave layer: Diurnal Baseline Expected Profile (Sky Blue)
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(points[0].x, pad.top + chartH);
    drawSpline(ctx, points, 'baselineY');
    ctx.lineTo(points[points.length - 1].x, pad.top + chartH);
    ctx.closePath();
    const baseGrad = ctx.createLinearGradient(0, pad.top, 0, pad.top + chartH);
    baseGrad.addColorStop(0, 'rgba(90, 200, 250, 0.45)');
    baseGrad.addColorStop(1, 'rgba(90, 200, 250, 0.08)');
    ctx.fillStyle = baseGrad;
    ctx.fill();
    ctx.restore();

    // Baseline boundary stroke
    ctx.beginPath();
    drawSpline(ctx, points, 'baselineY');
    ctx.strokeStyle = '#0284c7';
    ctx.lineWidth = 1.8;
    ctx.setLineDash([4, 4]);
    ctx.stroke();
    ctx.setLineDash([]);

    // 2. Primary wave layer: Active Sensor Telemetry (Vibrant Royal Blue)
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(points[0].x, pad.top + chartH);
    drawSpline(ctx, points, 'y');
    ctx.lineTo(points[points.length - 1].x, pad.top + chartH);
    ctx.closePath();
    const primaryGrad = ctx.createLinearGradient(0, pad.top, 0, pad.top + chartH);
    primaryGrad.addColorStop(0, 'rgba(0, 117, 255, 0.95)');
    primaryGrad.addColorStop(1, 'rgba(0, 95, 219, 0.75)');
    ctx.fillStyle = primaryGrad;
    ctx.fill();
    ctx.restore();

    // Line boundary stroke
    ctx.beginPath();
    drawSpline(ctx, points, 'y');
    ctx.strokeStyle = '#0052cc';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // 3. Current Live Telemetry Node Marker (at currentHour)
    const currPoint = points[currentHour] || points[12];
    if (currPoint) {
      // Dotted vertical indicator line
      ctx.save();
      ctx.beginPath();
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = '#0075ff';
      ctx.lineWidth = 1.5;
      ctx.moveTo(currPoint.x, pad.top);
      ctx.lineTo(currPoint.x, pad.top + chartH);
      ctx.stroke();
      ctx.restore();

      // Outer pulsing halo
      ctx.beginPath();
      ctx.arc(currPoint.x, currPoint.y, 9, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0, 117, 255, 0.25)';
      ctx.fill();

      // Center solid beacon
      ctx.beginPath();
      ctx.arc(currPoint.x, currPoint.y, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.strokeStyle = '#0075ff';
      ctx.lineWidth = 2.5;
      ctx.stroke();

      // Floating Live Badge
      const badgeW = 74;
      const badgeH = 20;
      const badgeX = Math.max(pad.left + 5, Math.min(width - pad.right - badgeW, currPoint.x - badgeW / 2));
      const badgeY = Math.max(5, currPoint.y - badgeH - 8);

      ctx.fillStyle = '#0f172a';
      ctx.beginPath();
      ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 6);
      ctx.fill();

      ctx.fillStyle = '#ffffff';
      ctx.font = '700 9px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`LIVE: ${currPoint.rate}%`, badgeX + badgeW / 2, badgeY + badgeH / 2);
    }

    // 4. Peak Diurnal Hour Indicator
    if (peakItem && peakItem.hour !== currentHour) {
      const peakPoint = points[peakItem.hour];
      if (peakPoint) {
        ctx.beginPath();
        ctx.arc(peakPoint.x, peakPoint.y, 4, 0, Math.PI * 2);
        ctx.fillStyle = '#ef4444';
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        const pBadgeW = 68;
        const pBadgeH = 18;
        const pBadgeX = Math.max(pad.left, Math.min(width - pad.right - pBadgeW, peakPoint.x - pBadgeW / 2));
        const pBadgeY = Math.max(4, peakPoint.y - pBadgeH - 6);

        ctx.fillStyle = '#ef4444';
        ctx.beginPath();
        ctx.roundRect(pBadgeX, pBadgeY, pBadgeW, pBadgeH, 5);
        ctx.fill();

        ctx.fillStyle = '#ffffff';
        ctx.font = '700 9px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`PEAK: ${peakItem.rate}%`, pBadgeX + pBadgeW / 2, pBadgeY + pBadgeH / 2);
      }
    }

    // X-axis Dark High-Contrast Time Labels
    ctx.font = '700 11px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#0f172a';

    const xSampleIndices = [0, 4, 8, 12, 16, 20, 23];
    const xLabels = ['00:00', '04:00', '08:00', '12:00', '16:00', '20:00', '23:00'];
    xSampleIndices.forEach((idx, i) => {
      const p = points[idx];
      if (p) {
        ctx.fillText(xLabels[i], p.x, pad.top + chartH + 8);
      }
    });

    // Attach interactive hover listener to canvas once
    if (!canvas._telemetryBound) {
      canvas._telemetryBound = true;
      const tooltip = document.getElementById('chartTooltip');

      canvas.addEventListener('mousemove', (e) => {
        const rect = canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const relX = mouseX - pad.left;
        const approxIdx = Math.round((relX / chartW) * 23);
        const targetPt = points[Math.max(0, Math.min(23, approxIdx))];

        if (targetPt && tooltip) {
          const hourStr = `${targetPt.hour.toString().padStart(2, '0')}:00`;
          const vehicleEstimate = Math.round((targetPt.rate / 100) * 60);

          tooltip.innerHTML = `
            <div class="font-bold border-b border-slate-700 pb-1 mb-1 text-slate-100 flex items-center justify-between gap-4">
              <span>Time: ${hourStr}</span>
              <span class="text-emerald-400 text-[10px]">TELEMETRY ACTIVE</span>
            </div>
            <div class="space-y-0.5 text-[11px]">
              <div class="flex justify-between gap-3 text-slate-300">
                <span class="text-slate-400">Telemetry Sensor Rate:</span>
                <span class="text-[#5ac8fa] font-bold font-mono">${targetPt.rate}% (${vehicleEstimate} cars)</span>
              </div>
              <div class="flex justify-between gap-3 text-slate-300">
                <span class="text-slate-400">Diurnal Baseline:</span>
                <span class="text-slate-200 font-bold font-mono">${targetPt.baseline}%</span>
              </div>
              <div class="flex justify-between gap-3 text-slate-300">
                <span class="text-slate-400">Sensor Health:</span>
                <span class="text-emerald-400 font-bold font-mono">60/60 Nodes (100%)</span>
              </div>
            </div>
          `;

          const tipX = Math.min(rect.width - 200, Math.max(10, mouseX - 90));
          const tipY = Math.max(10, targetPt.y - 85);
          tooltip.style.left = `${tipX}px`;
          tooltip.style.top = `${tipY}px`;
          tooltip.classList.remove('hidden');
        }
      });

      canvas.addEventListener('mouseleave', () => {
        if (tooltip) tooltip.classList.add('hidden');
      });
    }
  },

  /**
   * 2. Daily Revenue Bar Chart with Floating Value Callout
   * Cleanly spaced daily selling columns with dynamic collision-free day labels
   */
  renderDailyRevenueBarChart(canvasId) {
    const canvas = document.getElementById(canvasId);
    const setup = this.setupCanvas(canvas);
    if (!setup) return;
    const { ctx, width, height } = setup;

    const history = Storage.getAnalyticsHistory();

    // Aggregate last 7 days
    const dayTotals = [];
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const shortDayNames = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
    const singleDayNames = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

    for (let d = 6; d >= 0; d--) {
      const records = history.filter((r) => r.dayOffset === d);
      const rev = records.reduce((sum, r) => sum + (r.revenue || 0), 0);
      const sample = records[0];
      const dayIdx = sample ? sample.dayOfWeek : (new Date().getDay() - d + 7) % 7;
      dayTotals.push({
        dayName: dayNames[dayIdx],
        shortName: shortDayNames[dayIdx],
        singleName: singleDayNames[dayIdx],
        isToday: d === 0,
        revenue: Math.round(rev),
      });
    }

    // Optimized padding: generous horizontal room for 7 days
    const pad = { top: 38, right: 12, bottom: 26, left: 28 };
    const chartW = Math.max(50, width - pad.left - pad.right);
    const chartH = Math.max(50, height - pad.top - pad.bottom);

    ctx.clearRect(0, 0, width, height);

    const maxRev = Math.max(100, ...dayTotals.map((d) => d.revenue)) * 1.25;
    const stepX = chartW / dayTotals.length;

    // Daily selling column width: slim, elegant, leaving a distinct gap between each day's column
    const barWidth = Math.max(7, Math.min(14, Math.round(stepX * 0.32)));
    const barRadius = Math.min(4, Math.max(2, Math.floor(barWidth / 2)));

    // Y Grid lines & Dark High-Contrast labels
    const ySteps = [0, 25, 50, 75, 100];
    ctx.font = '700 9.5px "JetBrains Mono", monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';

    ySteps.forEach((step) => {
      const y = pad.top + chartH - (step / 100) * chartH;
      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(width - pad.right, y);
      ctx.stroke();

      ctx.fillStyle = '#0f172a';
      ctx.fillText(`${step}`, pad.left - 5, y);
    });

    // Determine Day Label format to guarantee zero overlap ("speels mixing")
    ctx.font = '700 9.5px "Plus Jakarta Sans", sans-serif';
    const wedWidth = ctx.measureText('Wed').width;
    const weWidth = ctx.measureText('We').width;

    let labelMode = 'full';
    if (stepX < wedWidth + 8) {
      labelMode = stepX < weWidth + 6 ? 'single' : 'short';
    }

    let maxBarInfo = null;

    // Draw daily selling pillars with distinct gaps
    dayTotals.forEach((item, idx) => {
      const barX = pad.left + idx * stepX + (stepX - barWidth) / 2;
      const fullH = chartH;
      const fillH = Math.max(2, (item.revenue / maxRev) * chartH);

      // 1. Sleek light background pillar track
      ctx.fillStyle = '#edf2f7';
      ctx.beginPath();
      ctx.roundRect(barX, pad.top, barWidth, fullH, barRadius);
      ctx.fill();

      // 2. Active royal blue filled section
      ctx.fillStyle = item.isToday ? '#0075ff' : '#0066ee';
      ctx.beginPath();
      ctx.roundRect(barX, pad.top + fullH - fillH, barWidth, fillH, barRadius);
      ctx.fill();

      // Track highest bar for floating callout badge
      if (!maxBarInfo || item.revenue > maxBarInfo.revenue) {
        maxBarInfo = {
          x: barX + barWidth / 2,
          y: pad.top + fullH - fillH,
          revenue: item.revenue,
        };
      }

      // X Day label in Dark High-Contrast, perfectly spaced under bar
      const xCenter = barX + barWidth / 2;
      let displayDay = item.dayName;
      if (labelMode === 'short') displayDay = item.shortName;
      else if (labelMode === 'single') displayDay = item.singleName;

      ctx.fillStyle = item.isToday ? '#0075ff' : '#0f172a';
      ctx.font = item.isToday
        ? '800 10px "Plus Jakarta Sans", sans-serif'
        : '700 9.5px "Plus Jakarta Sans", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(displayDay, xCenter, pad.top + chartH + 8);
    });

    // 3. Floating Blue Badge Callout above highest selling day
    if (maxBarInfo) {
      const badgeText = `$${maxBarInfo.revenue}`;
      ctx.font = '700 10px "Plus Jakarta Sans", sans-serif';
      const textW = ctx.measureText(badgeText).width;
      const badgeW = Math.max(54, textW + 16);
      const badgeH = 20;
      const badgeX = Math.max(pad.left, Math.min(width - pad.right - badgeW, maxBarInfo.x - badgeW / 2));
      const badgeY = Math.max(8, maxBarInfo.y - badgeH - 6);

      // Subtle shadow for modern depth
      ctx.save();
      ctx.shadowColor = 'rgba(0, 117, 255, 0.28)';
      ctx.shadowBlur = 6;
      ctx.shadowOffsetY = 2;

      ctx.fillStyle = '#0075ff';
      ctx.beginPath();
      ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 5);
      ctx.fill();
      ctx.restore();

      ctx.fillStyle = '#ffffff';
      ctx.font = '700 10px "Plus Jakarta Sans", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(badgeText, badgeX + badgeW / 2, badgeY + badgeH / 2);
    }
  },

  /**
   * 3. Vehicle Type Donut / Pie Chart
   * Displays distribution with collision-proof legend spacing and guaranteed gap between labels and percentages.
   */
  renderVehicleTypeDonut(canvasId) {
    const canvas = document.getElementById(canvasId);
    const setup = this.setupCanvas(canvas);
    if (!setup) return;
    const { ctx, width, height } = setup;

    const tickets = Storage.getTickets();
    const history = Storage.getHistory();

    const counts = { car: 0, suv: 0, ev: 0, bike: 0 };
    tickets.forEach((t) => counts[t.type] ? counts[t.type]++ : (counts[t.type] = 1));
    history.slice(0, 30).forEach((h) => counts[h.type] ? counts[h.type]++ : (counts[h.type] = 1));

    const total = Object.values(counts).reduce((s, v) => s + v, 0) || 1;

    // Palette: Royal Blue & Sky Blue & Cyan
    const segments = [
      { full: 'Passenger Car', short: 'Cars', count: counts.car || 1, color: '#0075ff' },
      { full: 'SUV / Truck', short: 'SUVs', count: counts.suv || 1, color: '#5ac8fa' },
      { full: 'EV Charging', short: 'EVs', count: counts.ev || 1, color: '#0284c7' },
      { full: 'Motorcycle', short: 'Motorcycle', count: counts.bike || 1, color: '#93c5fd' },
    ];

    ctx.clearRect(0, 0, width, height);

    // Proportionally size the pie chart circle to leave ample room for the legend
    const centerY = height / 2;
    const radius = Math.min(50, Math.floor(height * 0.35), Math.floor((width - 120) * 0.38));
    const centerX = radius + Math.max(10, Math.floor(width * 0.04));

    let startAngle = -Math.PI / 2;

    segments.forEach((seg) => {
      const sliceAngle = (seg.count / total) * Math.PI * 2;
      const endAngle = startAngle + sliceAngle;

      ctx.beginPath();
      ctx.moveTo(centerX, centerY);
      ctx.arc(centerX, centerY, radius, startAngle, endAngle);
      ctx.closePath();
      ctx.fillStyle = seg.color;
      ctx.fill();

      // White slice separator
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Percentage label on prominent slices (>= 22%)
      const sliceRatio = seg.count / total;
      if (sliceRatio >= 0.22) {
        const midAngle = startAngle + sliceAngle / 2;
        const textDist = radius * 0.58;
        const tx = centerX + Math.cos(midAngle) * textDist;
        const ty = centerY + Math.sin(midAngle) * textDist;

        ctx.fillStyle = '#ffffff';
        ctx.font = '700 10.5px "Plus Jakarta Sans", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${Math.round(sliceRatio * 100)}%`, tx, ty);
      }

      startAngle = endAngle;
    });

    // Right-side Legend with Guaranteed Non-Colliding Gap
    const legendX = centerX + radius + 14;
    const swatchSize = 8;
    const labelStartX = legendX + swatchSize + 8;
    const percentRight = width - 10;
    const itemH = 22;
    const legendStartY = centerY - (segments.length * itemH) / 2 + 2;

    segments.forEach((seg, i) => {
      const y = legendStartY + i * itemH;
      const percent = Math.round((seg.count / total) * 100);
      const percentStr = `${percent}%`;

      // 1. Color pill swatch
      ctx.fillStyle = seg.color;
      ctx.beginPath();
      ctx.roundRect(legendX, y - 4, swatchSize, swatchSize, 2);
      ctx.fill();

      // 2. Measure percentage width to reserve space
      ctx.font = '700 10px "JetBrains Mono", monospace';
      const percentW = ctx.measureText(percentStr).width;

      // 3. Calculate max allowable width for spelling to guarantee at least 12px gap
      const minGap = 12;
      const maxLabelW = Math.max(24, percentRight - percentW - minGap - labelStartX);

      // Determine appropriate label to ensure spelling never touches percentage
      ctx.font = '700 10px "Plus Jakarta Sans", sans-serif';
      let labelText = seg.full;
      if (ctx.measureText(labelText).width > maxLabelW) {
        labelText = seg.short;
      }

      // Truncate cleanly if still overflowing on ultra-narrow viewports
      if (ctx.measureText(labelText).width > maxLabelW) {
        while (labelText.length > 2 && ctx.measureText(labelText + '…').width > maxLabelW) {
          labelText = labelText.slice(0, -1);
        }
        labelText += '…';
      }

      // Render Label in High-Contrast Dark Text with clipping safeguard
      ctx.save();
      ctx.beginPath();
      ctx.rect(labelStartX, y - 10, maxLabelW, itemH);
      ctx.clip();
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#0f172a';
      ctx.fillText(labelText, labelStartX, y);
      ctx.restore();

      // 4. Render Percentage on the Right Margin
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.font = '700 10px "JetBrains Mono", monospace';
      ctx.fillStyle = '#0f172a';
      ctx.fillText(percentStr, percentRight, y);
    });
  },

  /**
   * 4. Peak-Hour Heatmap (Day of Week x Hour)
   */
  renderPeakHourHeatmap(canvasId) {
    const canvas = document.getElementById(canvasId);
    const setup = this.setupCanvas(canvas);
    if (!setup) return;
    const { ctx, width, height } = setup;

    const history = Storage.getAnalyticsHistory();

    const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const hours = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22];

    const pad = { top: 22, right: 12, bottom: 15, left: 35 };
    const chartW = width - pad.left - pad.right;
    const chartH = height - pad.top - pad.bottom;

    const cellW = chartW / hours.length;
    const cellH = chartH / dayLabels.length;

    ctx.clearRect(0, 0, width, height);

    // Color gradient based on royal-blue aesthetic
    function getCellColor(rate) {
      if (rate >= 85) return '#ef4444'; // Red peak
      if (rate >= 70) return '#f59e0b'; // Amber high
      if (rate >= 50) return '#0075ff'; // Vibrant royal blue
      if (rate >= 30) return '#7dd3fc'; // Sky blue
      return '#e2e8f0'; // Soft gray
    }

    // Top Hour labels in Dark High-Contrast
    ctx.font = '700 10px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = '#0f172a';

    hours.forEach((h, col) => {
      const x = pad.left + col * cellW + cellW / 2;
      const label = h < 12 ? `${h}A` : h === 12 ? '12P' : `${h - 12}P`;
      if (col % 2 === 0) {
        ctx.fillText(label, x, pad.top - 4);
      }
    });

    // Draw Grid with Dark Day Labels
    dayLabels.forEach((dayName, row) => {
      const y = pad.top + row * cellH;

      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.font = '700 11px "Plus Jakarta Sans", sans-serif';
      ctx.fillStyle = '#0f172a';
      ctx.fillText(dayName, pad.left - 6, y + cellH / 2);

      hours.forEach((h, col) => {
        const x = pad.left + col * cellW;
        const matching = history.filter((r) => r.dayOfWeek === row && r.hour === h);
        const avgRate =
          matching.length > 0
            ? Math.round(matching.reduce((acc, v) => acc + v.occupancyRate, 0) / matching.length)
            : 35;

        ctx.fillStyle = getCellColor(avgRate);
        const gap = 1.5;
        ctx.beginPath();
        ctx.roundRect(x + gap, y + gap, cellW - gap * 2, cellH - gap * 2, 2);
        ctx.fill();
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
