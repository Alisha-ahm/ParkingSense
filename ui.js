/**
 * ParkSense - UI Module
 * Handles DOM rendering, view transitions, slot map layout, animated car trajectories,
 * count-up KPI animations, circular progress rings, toast alerts, modals, and CSV export.
 */

import { Storage } from './storage.js';
import { ParkingManager } from './parking.js';
import { BillingEngine } from './billing.js';
import { ChartRenderer } from './charts.js';
import { PredictionEngine } from './prediction.js';

export const UI = {
  currentFloor: 1,
  activeTooltip: null,
  activeFilter: {
    search: '',
    type: 'all',
    status: 'all',
    floor: 'all',
    sortBy: 'entryTime',
    sortDir: 'desc',
  },

  init() {
    document.documentElement.classList.remove('dark');
    try { localStorage.removeItem('parksense_theme'); } catch (_) {}
    this.updateUserRoleBadge(Storage.getRole());
    this.renderSurgeBadge();
    this.renderNotificationsBadge();
    this.setupGlobalListeners();
  },

  /**
   * Updates top bar role badge and adjusts navigation visibility based on role permissions.
   */
  updateUserRoleBadge(role) {
    Storage.setRole(role);
    const badge = document.getElementById('currentRoleLabel');
    if (badge) {
      badge.textContent = role.toUpperCase();
    }

    // Role-based visibility
    document.querySelectorAll('[data-role-required]').forEach((el) => {
      const required = el.getAttribute('data-role-required');
      if (role === 'admin') {
        el.style.display = '';
      } else if (role === 'attendant') {
        el.style.display = required === 'admin' ? 'none' : '';
      } else if (role === 'driver') {
        el.style.display = required === 'admin' || required === 'attendant' ? 'none' : '';
      }
    });

    this.showToast(`Switched active profile to ${role.toUpperCase()}`, 'info');
  },

  /**
   * Sets up top bar, global dropdowns, modal dismissals, and window resize listeners.
   */
  setupGlobalListeners() {
    // Role switcher dropdown
    const roleSelect = document.getElementById('roleSelect');
    if (roleSelect) {
      roleSelect.value = Storage.getRole();
      roleSelect.addEventListener('change', (e) => {
        this.updateUserRoleBadge(e.target.value);
        this.refreshActiveSection();
      });
    }

    // Notification tray toggle
    const notifBtn = document.getElementById('notifCenterBtn');
    const notifTray = document.getElementById('notifDropdownTray');
    if (notifBtn && notifTray) {
      notifBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isHidden = notifTray.classList.contains('hidden');
        if (isHidden) {
          this.renderNotificationList();
          notifTray.classList.remove('hidden');
          Storage.markNotificationsRead();
          this.renderNotificationsBadge();
        } else {
          notifTray.classList.add('hidden');
        }
      });

      document.addEventListener('click', (e) => {
        if (!notifTray.contains(e.target) && !notifBtn.contains(e.target)) {
          notifTray.classList.add('hidden');
        }
      });
    }

    // Mobile sidebar hamburger toggle
    const menuBtn = document.getElementById('mobileMenuBtn');
    const sidebar = document.getElementById('appSidebar');
    if (menuBtn && sidebar) {
      menuBtn.addEventListener('click', () => {
        sidebar.classList.toggle('-translate-x-full');
      });
    }

    // Window resize debounced redraw for charts
    let resizeTimer;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        ChartRenderer.refreshAll();
      }, 250);
    });
  },

  /**
   * Smooth animated count-up for numbers in KPI cards.
   */
  animateCountUp(elementId, targetValue, duration = 800, prefix = '', suffix = '', decimals = 0) {
    const el = document.getElementById(elementId);
    if (!el) return;

    const start = parseFloat(el.getAttribute('data-current-val') || '0');
    const end = parseFloat(targetValue);
    if (isNaN(end)) return;

    const startTime = performance.now();

    function update(currentTime) {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // Ease out cubic
      const ease = 1 - Math.pow(1 - progress, 3);
      const current = start + (end - start) * ease;

      el.textContent = `${prefix}${current.toFixed(decimals)}${suffix}`;

      if (progress < 1) {
        requestAnimationFrame(update);
      } else {
        el.textContent = `${prefix}${end.toFixed(decimals)}${suffix}`;
        el.setAttribute('data-current-val', end.toString());
      }
    }

    requestAnimationFrame(update);
  },

  /**
   * Updates all Dashboard KPI metrics with count-up animations and circular gauge.
   */
  renderDashboardKPIs() {
    const slots = Storage.getSlots();
    const tickets = Storage.getTickets();
    const history = Storage.getHistory();
    const totalSlots = slots.length || 60;

    const occupiedSlots = slots.filter(
      (s) => s.status === 'occupied' || s.status === 'ev_charging'
    ).length;
    const reservedSlots = slots.filter((s) => s.status === 'reserved').length;
    const occupancyRate = Math.round((occupiedSlots / totalSlots) * 100);

    // Vehicles today = currently parked + history today
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const completedToday = history.filter((h) => h.exitTime >= startOfDay);
    const vehiclesToday = tickets.length + completedToday.length;

    // Revenue today
    const revenueToday = completedToday.reduce((sum, h) => sum + (h.fee || 0), 0);

    // Average duration (hours)
    let avgDurationStr = '0h 00m';
    if (completedToday.length > 0) {
      const avgH =
        completedToday.reduce((sum, h) => sum + (h.durationHours || 0), 0) / completedToday.length;
      const hoursPart = Math.floor(avgH);
      const minsPart = Math.round((avgH - hoursPart) * 60);
      avgDurationStr = `${hoursPart}h ${minsPart < 10 ? '0' : ''}${minsPart}m`;
    } else {
      avgDurationStr = '2h 15m';
    }

    // Per-floor free slots
    const f1Free = slots.filter((s) => s.floor === 1 && s.status === 'free').length;
    const f2Free = slots.filter((s) => s.floor === 2 && s.status === 'free').length;
    const f3Free = slots.filter((s) => s.floor === 3 && s.status === 'free').length;

    // Animate KPI numbers
    this.animateCountUp('kpiOccupancyNum', occupancyRate, 900, '', '%');
    this.animateCountUp('kpiVehiclesNum', vehiclesToday, 800, '', '');
    this.animateCountUp('kpiRevenueNum', revenueToday, 1000, '$', '', 2);

    const avgEl = document.getElementById('kpiAvgDuration');
    if (avgEl) avgEl.textContent = avgDurationStr;

    // Floor slot meters and progress bars
    const f1El = document.getElementById('kpiFloor1');
    const f2El = document.getElementById('kpiFloor2');
    const f3El = document.getElementById('kpiFloor3');
    if (f1El) f1El.textContent = `${f1Free} / 20 free`;
    if (f2El) f2El.textContent = `${f2Free} / 20 free`;
    if (f3El) f3El.textContent = `${f3Free} / 20 free`;

    const bar1 = document.getElementById('kpiBarFloor1');
    const bar2 = document.getElementById('kpiBarFloor2');
    const bar3 = document.getElementById('kpiBarFloor3');
    if (bar1) bar1.style.width = `${Math.round(((20 - f1Free) / 20) * 100)}%`;
    if (bar2) bar2.style.width = `${Math.round(((20 - f2Free) / 20) * 100)}%`;
    if (bar3) bar3.style.width = `${Math.round(((20 - f3Free) / 20) * 100)}%`;

    // Circular progress gauge for occupancy
    const circle = document.getElementById('occupancyCircleRing');
    const circleText = document.getElementById('occupancyCircleText');
    if (circle) {
      const radius = 40;
      const circumference = 2 * Math.PI * radius;
      const offset = circumference - (occupancyRate / 100) * circumference;
      circle.style.strokeDasharray = `${circumference}`;
      circle.style.strokeDashoffset = `${offset}`;

      // Royal blue accent matching reference image
      if (occupancyRate >= 80) {
        circle.style.stroke = '#ef4444'; // Red alert on critical
      } else {
        circle.style.stroke = '#0075ff'; // Vibrant royal blue
      }
    }
    if (circleText) {
      circleText.textContent = `${occupancyRate}%`;
    }

    this.renderSurgeBadge();
    this.renderQuickExitChips();
  },

  /**
   * Renders quick clickable chips for currently parked vehicles in the Exit & Billing section.
   */
  renderQuickExitChips() {
    const container = document.getElementById('quickExitPlateChips');
    if (!container) return;

    const tickets = Storage.getTickets();
    if (tickets.length === 0) {
      container.innerHTML = `<span class="text-xs text-slate-400 italic">No vehicles currently parked inside</span>`;
      return;
    }

    container.innerHTML = tickets.slice(0, 8).map((t) => {
      return `
        <button type="button" class="quick-exit-chip px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-[#0075FF] border border-slate-200 rounded-lg text-xs font-mono font-semibold transition-colors cursor-pointer" data-ticket-id="${t.ticketId}">
          ${t.plate} (${t.slotId})
        </button>
      `;
    }).join('');

    // Attach click listeners to auto-fill search input
    container.querySelectorAll('.quick-exit-chip').forEach((btn) => {
      btn.addEventListener('click', () => {
        const ticketId = btn.getAttribute('data-ticket-id');
        const input = document.getElementById('exitSearchInput');
        if (input) {
          input.value = ticketId;
          document.getElementById('exitSearchBtn')?.click();
        }
      });
    });
  },

  /**
   * Renders Dynamic Surge Pricing indicator in the top header and dashboard.
   */
  renderSurgeBadge() {
    const surge = BillingEngine.getSurgeStatus();
    const badge = document.getElementById('topSurgeBadge');
    if (!badge) return;

    badge.className = 'flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-mono font-medium transition-all';

    if (surge.type === 'surge') {
      badge.classList.add('bg-rose-500/15', 'text-rose-400', 'border', 'border-rose-500/30');
      badge.innerHTML = `<span class="w-2 h-2 rounded-full bg-rose-500 animate-pulse"></span> SURGE ACTIVE (+${surge.percentDelta}%)`;
    } else if (surge.type === 'discount') {
      badge.classList.add('bg-emerald-500/15', 'text-emerald-400', 'border', 'border-emerald-500/30');
      badge.innerHTML = `<span class="w-2 h-2 rounded-full bg-emerald-500"></span> OFF-PEAK (-${surge.percentDelta}%)`;
    } else {
      badge.classList.add('bg-slate-700/40', 'text-slate-300', 'border', 'border-slate-700/50');
      badge.innerHTML = `<span class="w-2 h-2 rounded-full bg-blue-400"></span> STANDARD RATES`;
    }
  },

  /**
   * Module 1: Live Parking Map Renderer across 3 floors.
   * Renders driving lanes, entry/exit gates, and slot grid with hover tooltips and click inspector.
   */
  renderParkingMap(floor = this.currentFloor) {
    this.currentFloor = floor;
    const container = document.getElementById('parkingGridContainer');
    if (!container) return;

    const slots = Storage.getSlots().filter((s) => s.floor === floor);

    // Update active floor tab buttons
    document.querySelectorAll('.floor-tab-btn').forEach((btn) => {
      const f = parseInt(btn.getAttribute('data-floor'), 10);
      if (f === floor) {
        btn.classList.add('bg-blue-600', 'text-white', 'shadow-sm');
        btn.classList.remove('text-slate-400', 'hover:text-slate-200');
      } else {
        btn.classList.remove('bg-blue-600', 'text-white', 'shadow-sm');
        btn.classList.add('text-slate-400', 'hover:text-slate-200');
      }
    });

    // Row 1: Slots 1 to 10
    // Central Drive Lane (with animated car lane)
    // Row 2: Slots 11 to 20
    const row1Slots = slots.filter((s) => s.number <= 10);
    const row2Slots = slots.filter((s) => s.number > 10);

    // Helper to get stylized vehicle silhouette SVG based on type
    const getVehicleSvg = (type) => {
      if (type === 'bike') {
        return `<svg class="w-6 h-6 text-emerald-400 opacity-90" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="5.5" cy="17.5" r="3.5"/><circle cx="18.5" cy="17.5" r="3.5"/><path d="M15 6a1 1 0 1 0 0-2 1 1 0 0 0 0 2zm-3 11.5L9 9H5m7 8.5l3.5-6L12 8h3l3 3.5"/></svg>`;
      } else if (type === 'suv') {
        return `<svg class="w-8 h-8 text-purple-400 opacity-90" viewBox="0 0 24 24" fill="currentColor"><path d="M4 11l2-4h12l2 4v6a1 1 0 0 1-1 1h-1a2 2 0 0 1-4 0H10a2 2 0 0 1-4 0H5a1 1 0 0 1-1-1v-6zm3 6a1 1 0 1 0 0-2 1 1 0 0 0 0 2zm10 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM6.5 10h11l-1.2-2.5h-8.6L6.5 10z"/></svg>`;
      } else if (type === 'ev') {
        return `<svg class="w-8 h-8 text-cyan-400 opacity-90" viewBox="0 0 24 24" fill="currentColor"><path d="M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5 11l1.5-4.5h11L19 11H5z"/><path d="M12 1v3m0 6V7" stroke="#06b6d4" stroke-width="2" stroke-linecap="round"/></svg>`;
      }
      // Standard car
      return `<svg class="w-8 h-8 text-blue-400 opacity-90" viewBox="0 0 24 24" fill="currentColor"><path d="M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5 11l1.5-4.5h11L19 11H5z"/></svg>`;
    };

    const slotCardHtml = (slot) => {
      let statusBorder = 'border-emerald-500/30';
      let statusLabel = 'AVAILABLE';
      let beaconClass = 'free';

      if (slot.status === 'occupied') {
        statusBorder = 'border-rose-500/40';
        statusLabel = 'OCCUPIED';
        beaconClass = 'occupied';
      } else if (slot.status === 'reserved') {
        statusBorder = 'border-amber-500/40';
        statusLabel = 'RESERVED';
        beaconClass = 'reserved';
      } else if (slot.status === 'ev_charging') {
        statusBorder = 'border-cyan-500/40';
        statusLabel = 'CHARGING';
        beaconClass = 'ev_charging';
      } else if (slot.status === 'out_of_service') {
        statusBorder = 'border-slate-600/40 opacity-60';
        statusLabel = 'MAINTENANCE';
        beaconClass = 'out_of_service';
      }

      let typeBadge = '';
      if (slot.isEv) typeBadge = `<span class="text-[9px] font-mono font-bold text-cyan-700 bg-cyan-100/70 px-1.5 py-0.5 rounded border border-cyan-300">EV</span>`;
      else if (slot.isAccessible) typeBadge = `<span class="text-[9px] font-mono font-bold text-blue-700 bg-blue-100/70 px-1.5 py-0.5 rounded border border-blue-300">ADA</span>`;
      else if (slot.type === 'bike') typeBadge = `<span class="text-[9px] font-mono font-bold text-emerald-700 bg-emerald-100/70 px-1.5 py-0.5 rounded border border-emerald-300">BIKE</span>`;
      else if (slot.type === 'suv') typeBadge = `<span class="text-[9px] font-mono font-bold text-purple-700 bg-purple-100/70 px-1.5 py-0.5 rounded border border-purple-300">SUV</span>`;

      return `
        <div 
          class="parking-bay slot-cell relative p-2.5 rounded-lg border flex flex-col justify-between cursor-pointer select-none group min-h-[118px] ${statusBorder}"
          data-slot-id="${slot.id}"
          tabindex="0"
          role="button"
          aria-label="Bay ${slot.id}, ${statusLabel}"
        >
          <!-- Bay Top Header: Beacon & ID -->
          <div class="flex items-center justify-between z-10">
            <div class="flex items-center gap-1.5">
              <span class="led-beacon ${beaconClass}" title="Status: ${statusLabel}"></span>
              <span class="font-mono text-xs font-bold tracking-tight text-white">${slot.id}</span>
            </div>
            ${typeBadge}
          </div>

          <!-- Bay Center: Vehicle Silhouette or Free Marker -->
          <div class="my-1.5 flex flex-col items-center justify-center text-center z-10 min-h-[46px]">
            ${
              slot.currentVehicle
                ? `
                  <div class="mb-1">${getVehicleSvg(slot.currentVehicle.type)}</div>
                  <span class="font-mono text-[11px] font-bold tracking-wider text-slate-100 bg-black/60 px-1.5 py-0.5 rounded border border-slate-700/60 shadow-sm">${slot.currentVehicle.plate}</span>
                `
                : `
                  <div class="text-[10px] font-mono font-bold tracking-widest text-emerald-400/80 mb-0.5">${statusLabel}</div>
                  <span class="text-[9px] font-mono text-slate-400">${slot.distance}m to gate</span>
                `
            }
          </div>

          <!-- Bay Bottom: Specs -->
          <div class="flex items-center justify-between text-[9px] text-slate-400 border-t border-slate-800/80 pt-1 z-10 font-mono">
            <span>BAY ${slot.number < 10 ? '0' + slot.number : slot.number}</span>
            <span class="capitalize text-slate-400">${slot.type}</span>
          </div>
        </div>
      `;
    };

    container.innerHTML = `
      <!-- Row 1: Bays 01-10 -->
      <div class="grid grid-cols-5 sm:grid-cols-10 gap-2.5">
        ${row1Slots.map(slotCardHtml).join('')}
      </div>

      <!-- Drive Road Lane with Navigation Arrows, Road Markings & Trajectory Overlay -->
      <div id="driveLaneTrack" class="drive-road-lane relative my-4 h-20 rounded-xl flex items-center justify-between px-3 sm:px-6 overflow-hidden">
        
        <!-- Entrance Zone with Pedestrian Crosswalk & Direction Arrow -->
        <div class="flex items-center gap-2 z-10">
          <div class="zebra-crossing hidden sm:block"></div>
          <div class="flex items-center gap-1.5 px-2.5 py-1 bg-emerald-950/80 border border-emerald-500/40 rounded text-emerald-300 font-mono text-[11px] shadow">
            <svg class="w-3.5 h-3.5 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M14 5l7 7m0 0l-7 7m7-7H3"/></svg>
            <span class="font-bold">INBOUND GATE 01</span>
          </div>
        </div>

        <!-- Center Road Striping -->
        <div class="road-marking-center hidden sm:block"></div>

        <!-- Road Speed Limit & Direction Sign -->
        <div class="z-10 hidden md:flex items-center gap-3 font-mono text-[10px] text-slate-400 bg-slate-900/80 px-3 py-1 rounded-full border border-slate-700/60">
          <span class="text-amber-400 font-bold border border-amber-400/50 rounded px-1">MAX 5 MPH</span>
          <span>ONE WAY CIRCULATION</span>
          <span class="text-blue-400">RADAR ACTIVE</span>
        </div>

        <!-- Trajectory Vehicle Icon (glides into slot) -->
        <div id="animatedCarIcon" class="absolute left-10 top-1/2 -translate-y-1/2 opacity-0 pointer-events-none z-30 transition-all filter drop-shadow-[0_4px_8px_rgba(0,0,0,0.8)]">
          <svg class="w-8 h-8 text-blue-400" viewBox="0 0 24 24" fill="currentColor"><path d="M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5 11l1.5-4.5h11L19 11H5z"/></svg>
        </div>

        <!-- Exit Barrier Zone -->
        <div class="flex items-center gap-2 z-10">
          <div class="flex items-center gap-1.5 px-2.5 py-1 bg-rose-950/80 border border-rose-500/40 rounded text-rose-300 font-mono text-[11px] shadow">
            <span class="font-bold">OUTBOUND BARRIER</span>
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M10 19l-7-7m0 0l7-7m-7 7h18"/></svg>
          </div>
          <div class="zebra-crossing hidden sm:block"></div>
        </div>
      </div>

      <!-- Row 2: Bays 11-20 -->
      <div class="grid grid-cols-5 sm:grid-cols-10 gap-2.5">
        ${row2Slots.map(slotCardHtml).join('')}
      </div>
    `;

    // Attach slot tooltips and click inspection handlers
    this.attachSlotInteractions();
  },

  /**
   * Animates a vehicle driving along the lane to or from an assigned slot.
   */
  animateCarDrive(slotId, action = 'entry') {
    const car = document.getElementById('animatedCarIcon');
    const slotEl = document.querySelector(`[data-slot-id="${slotId}"]`);
    const lane = document.getElementById('driveLaneTrack');
    if (!car || !slotEl || !lane) return;

    const laneRect = lane.getBoundingClientRect();
    const slotRect = slotEl.getBoundingClientRect();

    const targetX = slotRect.left - laneRect.left + slotRect.width / 2 - 16;

    if (action === 'entry') {
      car.style.transition = 'none';
      car.style.left = '30px';
      car.style.top = '50%';
      car.style.opacity = '1';
      car.style.transform = 'translateY(-50%) rotate(0deg)';

      requestAnimationFrame(() => {
        car.style.transition = 'all 1.1s cubic-bezier(0.25, 1, 0.5, 1)';
        car.style.left = `${targetX}px`;

        setTimeout(() => {
          // Slight turn towards bay
          const isRow1 = slotId.includes('-S0') || slotId.includes('-S10');
          car.style.transform = isRow1 ? 'translateY(-50%) rotate(-45deg)' : 'translateY(-50%) rotate(45deg)';
          slotEl.classList.add('slot-pulse');

          setTimeout(() => {
            car.style.opacity = '0';
            slotEl.classList.remove('slot-pulse');
          }, 600);
        }, 1100);
      });
    } else {
      // Exit animation
      car.style.transition = 'none';
      car.style.left = `${targetX}px`;
      car.style.top = '50%';
      car.style.opacity = '1';
      car.style.transform = 'translateY(-50%) rotate(0deg)';

      requestAnimationFrame(() => {
        car.style.transition = 'all 1.1s cubic-bezier(0.25, 1, 0.5, 1)';
        car.style.left = `${laneRect.width - 60}px`;

        setTimeout(() => {
          car.style.opacity = '0';
        }, 1150);
      });
    }
  },

  /**
   * Tooltip and modal handlers for slot cards.
   */
  attachSlotInteractions() {
    const tooltip = document.getElementById('slotHoverTooltip');
    const slots = Storage.getSlots();

    document.querySelectorAll('.slot-cell').forEach((cell) => {
      const slotId = cell.getAttribute('data-slot-id');
      const slot = slots.find((s) => s.id === slotId);
      if (!slot) return;

      // Hover Tooltip
      cell.addEventListener('mouseenter', (e) => {
        if (!tooltip) return;
        const rect = cell.getBoundingClientRect();
        let parkedDuration = '—';
        if (slot.currentVehicle?.entryTime) {
          const mins = Math.round((Date.now() - slot.currentVehicle.entryTime) / 60000);
          parkedDuration = `${Math.floor(mins / 60)}h ${mins % 60}m`;
        }

        tooltip.innerHTML = `
          <div class="font-bold text-xs text-white border-b border-slate-700 pb-1 mb-1 flex items-center justify-between">
            <span>Slot ${slot.id}</span>
            <span class="text-[10px] text-blue-400 font-mono">${slot.distance}m from entry</span>
          </div>
          <div class="space-y-0.5 text-[11px] text-slate-300">
            <div><span class="text-slate-400">Status:</span> <span class="capitalize font-semibold text-slate-200">${slot.status.replace('_', ' ')}</span></div>
            <div><span class="text-slate-400">Vehicle:</span> <span class="font-mono text-white">${slot.currentVehicle?.plate || 'None'}</span></div>
            <div><span class="text-slate-400">Type:</span> <span class="capitalize">${slot.type} ${slot.isEv ? '(EV Charging)' : ''}</span></div>
            ${slot.currentVehicle ? `<div><span class="text-slate-400">Duration:</span> <span class="font-mono">${parkedDuration}</span></div>` : ''}
          </div>
        `;

        tooltip.style.left = `${rect.left + window.scrollX + rect.width / 2}px`;
        tooltip.style.top = `${rect.top + window.scrollY - 8}px`;
        tooltip.classList.remove('hidden');
      });

      cell.addEventListener('mouseleave', () => {
        if (tooltip) tooltip.classList.add('hidden');
      });

      // Click to open inspection modal
      cell.addEventListener('click', () => {
        this.openSlotModal(slot);
      });
    });
  },

  /**
   * Opens detailed inspection modal for an individual slot.
   */
  openSlotModal(slot) {
    const modal = document.getElementById('slotDetailModal');
    const content = document.getElementById('slotDetailContent');
    if (!modal || !content) return;

    const role = Storage.getRole();
    let parkedDuration = '—';
    if (slot.currentVehicle?.entryTime) {
      const mins = Math.round((Date.now() - slot.currentVehicle.entryTime) / 60000);
      parkedDuration = `${Math.floor(mins / 60)}h ${mins % 60}m ago`;
    }

    content.innerHTML = `
      <div class="flex items-center justify-between border-b border-slate-200 pb-3 mb-4">
        <div>
          <h3 class="text-lg font-extrabold text-slate-900">Slot ${slot.id} (Level ${slot.floor})</h3>
          <span class="text-xs text-slate-700 font-bold font-mono">Distance to Entry: ${slot.distance} meters</span>
        </div>
        <span class="px-2.5 py-1 text-xs font-mono uppercase font-extrabold rounded-md ${
          slot.status === 'free' ? 'bg-emerald-100 text-emerald-800 border border-emerald-300' :
          slot.status === 'occupied' ? 'bg-rose-100 text-rose-800 border border-rose-300' :
          slot.status === 'reserved' ? 'bg-amber-100 text-amber-800 border border-amber-300' :
          slot.status === 'ev_charging' ? 'bg-blue-100 text-blue-800 border border-blue-300' :
          'bg-slate-200 text-slate-800 border border-slate-300'
        }">
          ${slot.status.replace('_', ' ')}
        </span>
      </div>

      <div class="grid grid-cols-2 gap-3 text-xs mb-5">
        <div class="bg-slate-50 p-3 rounded-xl border border-slate-200">
          <span class="text-slate-800 block mb-1 font-bold">Slot Specifications</span>
          <div class="text-slate-900 font-semibold">Type: <span class="capitalize">${slot.type}</span></div>
          <div class="text-slate-900 font-semibold">EV Charger: <span>${slot.isEv ? 'Yes (Level 2 Fast)' : 'No'}</span></div>
          <div class="text-slate-900 font-semibold">Accessible: <span>${slot.isAccessible ? 'Yes (ADA Compliant)' : 'Standard'}</span></div>
        </div>

        <div class="bg-slate-50 p-3 rounded-xl border border-slate-200">
          <span class="text-slate-800 block mb-1 font-bold">Current Vehicle</span>
          ${
            slot.currentVehicle
              ? `
                <div class="text-slate-900 font-mono font-extrabold text-sm">${slot.currentVehicle.plate}</div>
                <div class="text-slate-700 font-medium">Parked: <span class="font-mono font-bold text-slate-900">${parkedDuration}</span></div>
                <div class="text-slate-700 font-mono text-[11px] truncate font-semibold">Ticket: ${slot.currentVehicle.ticketId}</div>
              `
              : `<div class="text-slate-500 italic font-medium">No vehicle currently parked</div>`
          }
        </div>
      </div>

      <div class="flex items-center justify-end gap-2 border-t border-slate-200 pt-3">
        ${
          slot.status === 'free'
            ? `
              <button id="modalQuickParkBtn" class="px-3.5 py-1.5 bg-[#0075FF] hover:bg-[#005fdb] text-white rounded-lg text-xs font-bold transition-colors cursor-pointer">
                Park Vehicle Here
              </button>
              <button id="modalMarkMaintenanceBtn" class="px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-300 rounded-lg text-xs font-bold transition-colors cursor-pointer">
                Set Out of Service
              </button>
            `
            : slot.status === 'out_of_service'
            ? `
              <button id="modalRestoreServiceBtn" class="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold transition-colors cursor-pointer">
                Restore to Service
              </button>
            `
            : `
              <button id="modalCheckoutVehicleBtn" class="px-3.5 py-1.5 bg-rose-600 hover:bg-rose-500 text-white rounded-lg text-xs font-bold transition-colors cursor-pointer">
                Process Checkout & Exit
              </button>
              ${slot.currentVehicle ? `
                <button id="modalViewTicketBtn" class="px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-300 rounded-lg text-xs font-bold transition-colors cursor-pointer">
                  View Ticket / QR
                </button>
              ` : ''}
            `
        }
        <button id="modalCloseSlotBtn" class="px-3.5 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-800 rounded-lg text-xs font-bold transition-colors cursor-pointer">
          Close
        </button>
      </div>
    `;

    modal.classList.remove('hidden');

    // Attach actions
    document.getElementById('modalCloseSlotBtn')?.addEventListener('click', () => {
      modal.classList.add('hidden');
    });

    document.getElementById('modalMarkMaintenanceBtn')?.addEventListener('click', () => {
      Storage.updateSlot(slot.id, { status: 'out_of_service' });
      this.showToast(`Slot ${slot.id} marked as Out of Service`, 'info');
      modal.classList.add('hidden');
      this.renderParkingMap();
      this.renderDashboardKPIs();
    });

    document.getElementById('modalRestoreServiceBtn')?.addEventListener('click', () => {
      Storage.updateSlot(slot.id, { status: 'free' });
      this.showToast(`Slot ${slot.id} restored to Active service`, 'success');
      modal.classList.add('hidden');
      this.renderParkingMap();
      this.renderDashboardKPIs();
    });

    document.getElementById('modalQuickParkBtn')?.addEventListener('click', () => {
      modal.classList.add('hidden');
      this.switchSection('entrySection');
      const slotInput = document.getElementById('entrySlotOverride');
      if (slotInput) slotInput.value = slot.id;
    });

    document.getElementById('modalCheckoutVehicleBtn')?.addEventListener('click', () => {
      modal.classList.add('hidden');
      this.switchSection('exitSection');
      if (slot.currentVehicle?.ticketId) {
        const ticketSearchInput = document.getElementById('exitSearchInput');
        if (ticketSearchInput) {
          ticketSearchInput.value = slot.currentVehicle.ticketId;
          document.getElementById('exitSearchBtn')?.click();
        }
      }
    });

    document.getElementById('modalViewTicketBtn')?.addEventListener('click', () => {
      modal.classList.add('hidden');
      if (slot.currentVehicle?.ticketId) {
        const ticket = Storage.getTicketMap().get(slot.currentVehicle.ticketId);
        if (ticket) this.showTicketModal(ticket);
      }
    });
  },

  /**
   * Displays printable digital ticket modal with Canvas QR code.
   */
  showTicketModal(ticket) {
    const modal = document.getElementById('ticketModal');
    if (!modal) return;

    document.getElementById('ticketModalId').textContent = ticket.ticketId;
    document.getElementById('ticketModalPlate').textContent = ticket.plate;
    document.getElementById('ticketModalSlot').textContent = ticket.slotId;
    document.getElementById('ticketModalFloor').textContent = `Floor ${ticket.floor}`;
    document.getElementById('ticketModalType').textContent = ticket.type.toUpperCase();
    document.getElementById('ticketModalTime').textContent = new Date(ticket.entryTime).toLocaleString();

    // Render Canvas QR Matrix
    const qrCanvas = document.getElementById('ticketQrCanvas');
    if (qrCanvas) {
      ParkingManager.drawTicketQR(qrCanvas, ticket.ticketId, 160);
    }

    modal.classList.remove('hidden');

    document.getElementById('ticketModalCloseBtn')?.addEventListener('click', () => {
      modal.classList.add('hidden');
    });

    document.getElementById('ticketModalPrintBtn')?.addEventListener('click', () => {
      window.print();
    });
  },

  /**
   * Displays printable payment receipt modal with itemized fee breakdown.
   */
  showReceiptModal(receipt) {
    const modal = document.getElementById('receiptModal');
    if (!modal) return;

    const b = receipt.feeBreakdown || {};

    document.getElementById('receiptId').textContent = receipt.id;
    document.getElementById('receiptDate').textContent = new Date(receipt.paidAt || Date.now()).toLocaleString();
    document.getElementById('receiptPlate').textContent = receipt.plate;
    document.getElementById('receiptTicket').textContent = receipt.ticketId;
    document.getElementById('receiptSlot').textContent = receipt.slotId;
    document.getElementById('receiptDuration').textContent = `${receipt.durationHours} hours`;
    document.getElementById('receiptRate').textContent = `$${(b.baseRatePerHour || 3.0).toFixed(2)}/hr`;
    document.getElementById('receiptMethod').textContent = (receipt.paymentMethod || 'CARD').toUpperCase();

    // Itemized lines
    const linesContainer = document.getElementById('receiptItemizedLines');
    if (linesContainer) {
      linesContainer.innerHTML = `
        <div class="flex justify-between py-1 border-b border-slate-700/40">
          <span>Base Parking (${b.billableHours || 1} hrs @ $${(b.baseRatePerHour || 3).toFixed(2)})</span>
          <span class="font-mono">$${(b.baseSubtotal || 0).toFixed(2)}</span>
        </div>
        ${
          b.dailyCapDiscount > 0
            ? `
              <div class="flex justify-between py-1 text-emerald-400 border-b border-slate-700/40">
                <span>Daily Maximum Cap Savings</span>
                <span class="font-mono">-$${b.dailyCapDiscount.toFixed(2)}</span>
              </div>
            `
            : ''
        }
        ${
          b.nightDiscountAmount > 0
            ? `
              <div class="flex justify-between py-1 text-emerald-400 border-b border-slate-700/40">
                <span>Night Discount (10PM-6AM)</span>
                <span class="font-mono">-$${b.nightDiscountAmount.toFixed(2)}</span>
              </div>
            `
            : ''
        }
        ${
          b.surgeAdjustmentAmount !== 0
            ? `
              <div class="flex justify-between py-1 ${b.surgeAdjustmentAmount > 0 ? 'text-rose-400' : 'text-emerald-400'} border-b border-slate-700/40">
                <span>Dynamic Rate Adjustment (${b.surgeMultiplier > 1 ? '+20% Surge' : '-10% Off-Peak'})</span>
                <span class="font-mono">${b.surgeAdjustmentAmount > 0 ? '+' : ''}$${b.surgeAdjustmentAmount.toFixed(2)}</span>
              </div>
            `
            : ''
        }
        ${
          b.overstayPenalty > 0
            ? `
              <div class="flex justify-between py-1 text-rose-400 border-b border-slate-700/40">
                <span>Overstay Penalty (>12 hrs)</span>
                <span class="font-mono">+$${b.overstayPenalty.toFixed(2)}</span>
              </div>
            `
            : ''
        }
        ${
          b.lostTicketFine > 0
            ? `
              <div class="flex justify-between py-1 text-rose-400 border-b border-slate-700/40">
                <span>Lost Ticket Replacement Fine</span>
                <span class="font-mono">+$${b.lostTicketFine.toFixed(2)}</span>
              </div>
            `
            : ''
        }
        ${
          b.graceApplied
            ? `
              <div class="flex justify-between py-1 text-emerald-400 font-bold border-b border-slate-700/40">
                <span>10-Minute Grace Period Applied</span>
                <span class="font-mono">$0.00</span>
              </div>
            `
            : ''
        }
      `;
    }

    document.getElementById('receiptTotal').textContent = `$${(receipt.fee || 0).toFixed(2)}`;

    modal.classList.remove('hidden');

    document.getElementById('receiptModalCloseBtn')?.addEventListener('click', () => {
      modal.classList.add('hidden');
    });

    document.getElementById('receiptModalPrintBtn')?.addEventListener('click', () => {
      window.print();
    });
  },

  /**
   * Module 4: Reservations Management View & Auto-Release Countdown.
   */
  renderReservations() {
    const container = document.getElementById('reservationsListContainer');
    if (!container) return;

    ParkingManager.checkReservationNoShows();
    const reservations = Storage.getReservations();
    const now = Date.now();

    if (reservations.length === 0) {
      container.innerHTML = `
        <div class="p-8 text-center text-slate-800 bg-slate-50 rounded-xl border border-slate-200 font-medium">
          <p class="text-sm font-bold text-slate-900">No active reservations currently scheduled.</p>
          <span class="text-xs text-slate-700 font-semibold">Drivers can book parking slots ahead of arrival.</span>
        </div>
      `;
      return;
    }

    container.innerHTML = reservations
      .map((res) => {
        const isPastStart = now >= res.startTime;
        const diffMs = res.startTime + 15 * 60 * 1000 - now; // 15 min no-show window
        const minutesLeft = Math.max(0, Math.floor(diffMs / 60000));
        const secondsLeft = Math.max(0, Math.floor((diffMs % 60000) / 1000));

        let statusBadge = '';
        if (res.status === 'confirmed') {
          if (!isPastStart) {
            statusBadge = `<span class="text-xs font-mono font-bold text-[#0075FF] bg-blue-50 px-2.5 py-1 rounded border border-blue-200">CONFIRMED</span>`;
          } else if (diffMs > 0) {
            statusBadge = `<span class="text-xs font-mono font-bold text-amber-800 bg-amber-50 px-2.5 py-1 rounded border border-amber-300 animate-pulse">ARRIVING (${minutesLeft}m ${secondsLeft}s grace left)</span>`;
          } else {
            statusBadge = `<span class="text-xs font-mono font-bold text-rose-700 bg-rose-50 px-2.5 py-1 rounded border border-rose-300">AUTO-RELEASED (NO SHOW)</span>`;
          }
        } else if (res.status === 'checked_in') {
          statusBadge = `<span class="text-xs font-mono font-bold text-emerald-800 bg-emerald-50 px-2.5 py-1 rounded border border-emerald-300">CHECKED IN</span>`;
        } else {
          statusBadge = `<span class="text-xs font-mono font-bold text-slate-800 bg-slate-100 px-2.5 py-1 rounded border border-slate-200">CANCELLED</span>`;
        }

        const startStr = new Date(res.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const endStr = new Date(res.endTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        return `
          <div class="p-4 rounded-xl bg-slate-50 border border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-lg bg-blue-50 text-[#0075FF] font-extrabold flex items-center justify-center font-mono text-sm border border-blue-200">
                ${res.slotId}
              </div>
              <div>
                <div class="flex items-center gap-2">
                  <h4 class="font-extrabold text-slate-900 text-sm">${res.driverName || 'Guest Driver'}</h4>
                  <span class="font-mono text-xs px-2 py-0.5 rounded bg-slate-200 text-slate-900 font-bold">${res.plate}</span>
                  <span class="text-xs uppercase text-slate-700 font-bold">(${res.type})</span>
                </div>
                <div class="text-xs text-slate-700 mt-0.5 font-semibold">
                  Window: <span class="text-slate-900 font-mono font-bold">${startStr} – ${endStr}</span>
                </div>
              </div>
            </div>

            <div class="flex items-center gap-3">
              ${statusBadge}
              ${
                res.status === 'confirmed'
                  ? `
                    <button class="res-checkin-btn px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold transition-colors cursor-pointer" data-res-id="${res.id}">
                      Check In
                    </button>
                    <button class="res-cancel-btn px-3 py-1.5 bg-slate-200 hover:bg-slate-300 text-rose-700 rounded-lg text-xs font-bold border border-slate-300 transition-colors cursor-pointer" data-res-id="${res.id}">
                      Cancel
                    </button>
                  `
                  : ''
              }
            </div>
          </div>
        `;
      })
      .join('');

    // Attach Reservation action buttons
    document.querySelectorAll('.res-checkin-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const resId = e.currentTarget.getAttribute('data-res-id');
        const res = Storage.getReservations().find((r) => r.id === resId);
        if (!res) return;

        try {
          const ticket = ParkingManager.assignSlot(res.slotId, res.plate, res.type);
          Storage.updateReservation(resId, { status: 'checked_in' });
          this.showToast(`Checked in reservation for ${res.plate} at ${res.slotId}!`, 'success');
          this.showTicketModal(ticket);
          this.renderReservations();
          this.renderParkingMap();
          this.renderDashboardKPIs();
        } catch (err) {
          this.showToast(err.message, 'error');
        }
      });
    });

    document.querySelectorAll('.res-cancel-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const resId = e.currentTarget.getAttribute('data-res-id');
        const res = Storage.getReservations().find((r) => r.id === resId);
        if (res) {
          Storage.updateReservation(resId, { status: 'cancelled' });
          Storage.updateSlot(res.slotId, { status: 'free' });
          this.showToast(`Reservation ${resId} cancelled. Slot freed.`, 'info');
          this.renderReservations();
          this.renderParkingMap();
          this.renderDashboardKPIs();
        }
      });
    });
  },

  /**
   * Module 11: Activity & History Table with Search, Filter, Sort, and CSV Export.
   */
  renderActivityTable() {
    const tbody = document.getElementById('activityTableBody');
    if (!tbody) return;

    const tickets = Storage.getTickets();
    const history = Storage.getHistory();

    // Combine active sessions and past completed sessions
    let records = [
      ...tickets.map((t) => ({
        id: t.ticketId,
        plate: t.plate,
        type: t.type,
        slotId: t.slotId,
        floor: t.floor,
        entryTime: t.entryTime,
        exitTime: null,
        durationHours: (Date.now() - t.entryTime) / (3600 * 1000),
        fee: null,
        status: t.isOverstay ? 'Overstay' : 'Active',
      })),
      ...history.map((h) => ({
        id: h.ticketId,
        plate: h.plate,
        type: h.type,
        slotId: h.slotId,
        floor: h.floor,
        entryTime: h.entryTime,
        exitTime: h.exitTime,
        durationHours: h.durationHours,
        fee: h.fee,
        status: 'Completed',
      })),
    ];

    // Filter by search query (Plate or Ticket ID)
    if (this.activeFilter.search) {
      const q = this.activeFilter.search.toUpperCase().trim();
      records = records.filter(
        (r) => r.plate.toUpperCase().includes(q) || r.id.toUpperCase().includes(q) || r.slotId.includes(q)
      );
    }

    // Filter by vehicle type
    if (this.activeFilter.type !== 'all') {
      records = records.filter((r) => r.type === this.activeFilter.type);
    }

    // Filter by status
    if (this.activeFilter.status !== 'all') {
      records = records.filter((r) => r.status.toLowerCase() === this.activeFilter.status.toLowerCase());
    }

    // Filter by floor
    if (this.activeFilter.floor !== 'all') {
      records = records.filter((r) => r.floor === parseInt(this.activeFilter.floor, 10));
    }

    // Sort records
    records.sort((a, b) => {
      let valA = a[this.activeFilter.sortBy];
      let valB = b[this.activeFilter.sortBy];
      if (valA === null) valA = 0;
      if (valB === null) valB = 0;

      if (this.activeFilter.sortDir === 'asc') {
        return valA > valB ? 1 : -1;
      } else {
        return valA < valB ? 1 : -1;
      }
    });

    if (records.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" class="text-center py-8 text-slate-500">
            No parking records match the selected filters.
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = records
      .slice(0, 100)
      .map((r) => {
        const entryStr = new Date(r.entryTime).toLocaleString([], {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        });
        const durationFormatted = `${Math.floor(r.durationHours)}h ${Math.round((r.durationHours % 1) * 60)}m`;
        const feeFormatted = r.fee !== null ? `$${r.fee.toFixed(2)}` : 'In Progress';

        let badgeClass = 'bg-blue-100 text-blue-800 border border-blue-300';
        if (r.status === 'Completed') {
          badgeClass = 'bg-slate-100 text-slate-800 border border-slate-300';
        } else if (r.status === 'Overstay') {
          badgeClass = 'bg-rose-100 text-rose-800 border border-rose-300';
        }

        return `
          <tr class="hover:bg-slate-50 transition-colors border-b border-slate-200 text-xs">
            <td class="py-2.5 px-3 font-mono font-extrabold text-slate-900">${r.plate}</td>
            <td class="py-2.5 px-3 uppercase text-slate-900 font-mono font-bold">${r.type}</td>
            <td class="py-2.5 px-3 font-mono font-bold text-slate-900">${r.slotId} (L${r.floor})</td>
            <td class="py-2.5 px-3 text-slate-700 font-semibold">${entryStr}</td>
            <td class="py-2.5 px-3 font-mono font-bold text-slate-900">${durationFormatted}</td>
            <td class="py-2.5 px-3 font-mono font-bold text-emerald-700">${feeFormatted}</td>
            <td class="py-2.5 px-3">
              <span class="px-2 py-0.5 rounded text-[10px] font-mono font-bold ${badgeClass}">
                ${r.status.toUpperCase()}
              </span>
            </td>
          </tr>
        `;
      })
      .join('');
  },

  /**
   * Generates and triggers instant CSV download of parking activity.
   */
  exportActivityCSV() {
    const tickets = Storage.getTickets();
    const history = Storage.getHistory();

    const headers = ['Record ID', 'Plate', 'Vehicle Type', 'Slot ID', 'Floor', 'Entry Time', 'Exit Time', 'Duration (Hours)', 'Fee ($)', 'Status'];
    const rows = [headers];

    // Add active
    tickets.forEach((t) => {
      const dur = ((Date.now() - t.entryTime) / 3600000).toFixed(2);
      rows.push([
        t.ticketId,
        t.plate,
        t.type,
        t.slotId,
        `Level ${t.floor}`,
        new Date(t.entryTime).toISOString(),
        'N/A',
        dur,
        'Active',
        t.isOverstay ? 'Overstay' : 'Active',
      ]);
    });

    // Add history
    history.forEach((h) => {
      rows.push([
        h.id,
        h.plate,
        h.type,
        h.slotId,
        `Level ${h.floor}`,
        new Date(h.entryTime).toISOString(),
        new Date(h.exitTime).toISOString(),
        h.durationHours.toFixed(2),
        h.fee.toFixed(2),
        'Completed',
      ]);
    });

    const csvContent = 'data:text/csv;charset=utf-8,' + rows.map((e) => e.join(',')).join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `parksense_activity_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    this.showToast('Activity report exported to CSV successfully.', 'success');
  },

  /**
   * Notification Center Tray Renderer.
   */
  renderNotificationList() {
    const listEl = document.getElementById('notifCenterList');
    if (!listEl) return;

    const notifs = Storage.getNotifications();
    if (notifs.length === 0) {
      listEl.innerHTML = `<div class="p-4 text-center text-xs text-slate-400">No new notifications.</div>`;
      return;
    }

    listEl.innerHTML = notifs
      .slice(0, 15)
      .map((n) => {
        let titleColor = 'text-[#0075FF]';
        if (n.type === 'warning') titleColor = 'text-amber-700';
        if (n.type === 'alert') titleColor = 'text-rose-700';
        if (n.type === 'success') titleColor = 'text-emerald-700';

        const timeStr = new Date(n.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        return `
          <div class="p-3 border-b border-slate-100 hover:bg-slate-50 transition-colors">
            <div class="flex items-center justify-between text-xs mb-1">
              <span class="font-extrabold ${titleColor}">${n.title}</span>
              <span class="text-[10px] text-slate-700 font-mono font-bold">${timeStr}</span>
            </div>
            <p class="text-xs text-slate-800 font-medium">${n.message}</p>
          </div>
        `;
      })
      .join('');
  },

  renderNotificationsBadge() {
    const notifs = Storage.getNotifications();
    const unread = notifs.filter((n) => !n.read).length;
    const badge = document.getElementById('notifUnreadBadge');
    if (!badge) return;

    if (unread > 0) {
      badge.textContent = unread > 9 ? '9+' : unread.toString();
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  },

  /**
   * Floating Toast Messages.
   */
  showToast(message, type = 'info') {
    const container = document.getElementById('toastNotificationCenter');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast-item flex items-center gap-2.5 px-4 py-3 rounded-lg shadow-xl text-xs font-medium text-white transition-all transform translate-y-2 opacity-0 select-none ${
      type === 'success' ? 'bg-emerald-600 border border-emerald-500' :
      type === 'error' ? 'bg-rose-600 border border-rose-500' :
      type === 'warning' ? 'bg-amber-600 border border-amber-500' :
      'bg-slate-800 border border-slate-700'
    }`;

    let iconSvg = '';
    if (type === 'success') {
      iconSvg = `<svg class="w-4 h-4 shrink-0 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"/></svg>`;
    } else if (type === 'error') {
      iconSvg = `<svg class="w-4 h-4 shrink-0 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12"/></svg>`;
    } else if (type === 'warning') {
      iconSvg = `<svg class="w-4 h-4 shrink-0 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>`;
    } else {
      iconSvg = `<svg class="w-4 h-4 shrink-0 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>`;
    }

    toast.innerHTML = `
      ${iconSvg}
      <span class="flex-1">${message}</span>
    `;

    container.appendChild(toast);

    requestAnimationFrame(() => {
      toast.classList.remove('translate-y-2', 'opacity-0');
    });

    setTimeout(() => {
      toast.classList.add('opacity-0', 'translate-y-2');
      setTimeout(() => toast.remove(), 300);
    }, 3800);
  },

  /**
   * Switches the active main section view with a smooth transition.
   */
  switchSection(sectionId) {
    // Hide all view sections
    document.querySelectorAll('.view-section').forEach((sec) => {
      sec.classList.add('hidden');
    });

    // Show target
    const target = document.getElementById(sectionId);
    if (target) {
      target.classList.remove('hidden');
      target.classList.add('section-fade-in');
      setTimeout(() => target.classList.remove('section-fade-in'), 300);
    }

    // Update active state in sidebar nav items
    document.querySelectorAll('.nav-link-item').forEach((link) => {
      if (link.getAttribute('data-target') === sectionId) {
        link.classList.add('bg-blue-600', 'text-white');
        link.classList.remove('text-slate-400', 'hover:bg-slate-800');
      } else {
        link.classList.remove('bg-blue-600', 'text-white');
        link.classList.add('text-slate-400', 'hover:bg-slate-800');
      }
    });

    // Refresh context data
    if (sectionId === 'dashboardSection') {
      this.renderDashboardKPIs();
      ChartRenderer.refreshAll();
    } else if (sectionId === 'mapSection') {
      this.renderParkingMap();
    } else if (sectionId === 'reservationsSection') {
      this.renderReservations();
    } else if (sectionId === 'analyticsSection') {
      ChartRenderer.refreshAll();
      this.renderPredictionCalculator();
    } else if (sectionId === 'activitySection') {
      this.renderActivityTable();
    }
  },

  /**
   * Interactive Peak-Hour Prediction Calculator Form renderer.
   */
  renderPredictionCalculator() {
    const daySelect = document.getElementById('predDaySelect');
    const hourSelect = document.getElementById('predHourSelect');
    const resultBox = document.getElementById('predictionResultDisplay');
    if (!daySelect || !hourSelect || !resultBox) return;

    const day = parseInt(daySelect.value, 10);
    const hour = parseInt(hourSelect.value, 10);

    const forecast = PredictionEngine.predictOccupancy(day, hour);

    resultBox.innerHTML = `
      <div class="p-4 rounded-xl bg-slate-50 border border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div class="flex items-center gap-2 mb-1">
            <span class="text-xs uppercase font-mono font-bold text-slate-800">Forecast for ${forecast.timeFormatted}:</span>
            <span class="px-2 py-0.5 rounded text-xs font-mono font-extrabold ${
              forecast.urgencyColor === 'rose' ? 'bg-rose-100 text-rose-800 border border-rose-300' :
              forecast.urgencyColor === 'amber' ? 'bg-amber-100 text-amber-800 border border-amber-300' :
              'bg-emerald-100 text-emerald-800 border border-emerald-300'
            }">
              ${forecast.statusBadge}
            </span>
          </div>
          <div class="text-2xl font-extrabold font-mono text-slate-900">
            ${forecast.predictedRate}% Expected Occupancy
            <span class="text-sm font-bold text-slate-700">(${forecast.predictedSlotsOccupied} / ${forecast.totalSlots} slots)</span>
          </div>
          <div class="text-xs text-slate-700 mt-1 font-semibold">
            Optimal Arrival Window: <span class="text-emerald-700 font-mono font-bold">${forecast.recommendedWindow}</span>
          </div>
        </div>

        <div class="flex flex-col items-end text-right">
          <span class="text-[11px] text-slate-800 font-bold">Algorithm Confidence</span>
          <div class="flex items-center gap-1.5 mt-0.5">
            <span class="text-lg font-extrabold font-mono text-[#0075FF]">${forecast.confidence}%</span>
            <span class="text-xs text-slate-700 font-mono font-semibold">(WMA model)</span>
          </div>
          <span class="text-[10px] text-slate-600 font-medium">Based on past 7-day diurnal patterns</span>
        </div>
      </div>
    `;
  },

  refreshActiveSection() {
    const visible = document.querySelector('.view-section:not(.hidden)');
    if (visible) {
      this.switchSection(visible.id);
    }
  },
};
