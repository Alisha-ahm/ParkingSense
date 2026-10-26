/**
 * ParkSense - Main Application Controller (app.js)
 * Coordinates all modules, handles simulation mode, form submissions,
 * periodic timer ticks, and demo data resets.
 */

import { Storage, DEFAULT_SETTINGS } from './storage.js';
import { ParkingManager } from './parking.js';
import { BillingEngine } from './billing.js';
import { PredictionEngine } from './prediction.js';
import { ChartRenderer } from './charts.js';
import { UI } from './ui.js';

class ParkSenseApp {
  constructor() {
    this.simulationActive = false;
    this.simulationInterval = null;
    this.clockInterval = null;
    this.countdownInterval = null;
  }

  init() {
    // 1. Initialize database and seed data if first time
    Storage.init();

    // 2. Initialize UI presentation layer
    UI.init();
    window.UI = UI;
    window.Storage = Storage;
    window.ParkingManager = ParkingManager;
    window.BillingEngine = BillingEngine;

    // 3. Setup navigation tabs
    this.setupNavigation();

    // 4. Setup Entry, Exit, Reservation, and Settings forms
    this.setupForms();

    // 5. Setup Live Simulation toggle
    this.setupSimulation();

    // 6. Start system clock and reservation timers
    this.startSystemTimers();

    // 7. Initial render of Dashboard & Parking Map
    UI.renderDashboardKPIs();
    UI.renderParkingMap(1);
    ChartRenderer.refreshAll();
  }

  /**
   * Sets up sidebar navigation click handlers.
   */
  setupNavigation() {
    // Sidebar nav links
    document.querySelectorAll('.nav-link-item').forEach((link) => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const targetSection = link.getAttribute('data-target');
        UI.switchSection(targetSection);

        // Close mobile sidebar if open
        const sidebar = document.getElementById('appSidebar');
        if (sidebar && !sidebar.classList.contains('-translate-x-full')) {
          sidebar.classList.add('-translate-x-full');
        }
      });
    });

    // Any in-page button with [data-navigate-to]
    document.querySelectorAll('[data-navigate-to]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const targetSection = btn.getAttribute('data-navigate-to');
        if (targetSection) {
          UI.switchSection(targetSection);
        }
      });
    });

    // Explicit binding for dashboard primary quick action buttons
    const checkInBtn = document.getElementById('dashCheckInBtn');
    if (checkInBtn) {
      checkInBtn.addEventListener('click', (e) => {
        e.preventDefault();
        UI.switchSection('entrySection');
      });
    }

    const viewGridBtn = document.getElementById('dashViewGridBtn');
    if (viewGridBtn) {
      viewGridBtn.addEventListener('click', (e) => {
        e.preventDefault();
        UI.switchSection('mapSection');
      });
    }

    // Live Telemetry / Baseline Profile pill toggles on Diurnal Chart
    const pill1 = document.getElementById('pillData1Btn');
    const pill2 = document.getElementById('pillData2Btn');
    if (pill1 && pill2) {
      pill1.addEventListener('click', () => {
        pill1.className = 'btn-pill-active text-xs cursor-pointer';
        pill2.className = 'btn-pill-inactive text-xs cursor-pointer';
        ChartRenderer.renderHourlyLineChart('hourlyChart', new Date().getDay(), 'live');
        UI.showToast('Switched to Live Ultrasonic Sensor Telemetry', 'info');
      });
      pill2.addEventListener('click', () => {
        pill2.className = 'btn-pill-active text-xs cursor-pointer';
        pill1.className = 'btn-pill-inactive text-xs cursor-pointer';
        ChartRenderer.renderHourlyLineChart('hourlyChart', (new Date().getDay() + 6) % 7, 'baseline');
        UI.showToast('Switched to 7-Day Diurnal Baseline Profile', 'info');
      });
    }

    // Location switcher button on top bar
    const locBtn = document.getElementById('locationSelectBtn');
    if (locBtn) {
      const locations = ['Terminal Deck #1', 'Terminal Deck #2', 'Terminal Deck #3'];
      let locIdx = 0;
      locBtn.addEventListener('click', () => {
        locIdx = (locIdx + 1) % locations.length;
        const span = locBtn.querySelector('span');
        if (span) span.textContent = `Location: ${locations[locIdx]}`;
        UI.renderParkingMap(locIdx + 1);
        UI.showToast(`Switched active view to ${locations[locIdx]}`, 'info');
      });
    }

    // Floor switch tabs on Parking Map
    document.querySelectorAll('.floor-tab-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const floor = parseInt(e.currentTarget.getAttribute('data-floor'), 10);
        UI.renderParkingMap(floor);
      });
    });
  }

  /**
   * Sets up all interactive forms (Entry, Exit/Billing, Reservation, Settings).
   */
  setupForms() {
    // 1. VEHICLE ENTRY FORM
    const entryForm = document.getElementById('vehicleEntryForm');
    if (entryForm) {
      entryForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const plateInput = document.getElementById('entryPlateInput');
        const typeSelect = document.getElementById('entryTypeSelect');
        const accessibleCheck = document.getElementById('entryAccessibleCheck');
        const slotOverride = document.getElementById('entrySlotOverride');

        const rawPlate = plateInput.value;
        const vehicleType = typeSelect.value;
        const requiresAccessible = accessibleCheck?.checked || false;

        // Validation 1: Plate format
        const plateValidation = ParkingManager.validatePlate(rawPlate);
        if (!plateValidation.valid) {
          UI.showToast(plateValidation.message, 'error');
          plateInput.focus();
          return;
        }

        const cleanPlate = plateValidation.cleanPlate;

        // Validation 2: Check if vehicle is already parked inside
        if (ParkingManager.isPlateInside(cleanPlate)) {
          UI.showToast(`Vehicle ${cleanPlate} is already parked inside the facility!`, 'error');
          return;
        }

        // Validation 3: Find or assign slot
        let targetSlot = null;
        if (slotOverride && slotOverride.value.trim()) {
          const overrideId = slotOverride.value.trim().toUpperCase();
          targetSlot = Storage.getSlots().find((s) => s.id === overrideId);
          if (!targetSlot || (targetSlot.status !== 'free' && targetSlot.status !== 'reserved')) {
            UI.showToast(`Specified slot ${overrideId} is not available.`, 'error');
            return;
          }
        } else {
          targetSlot = ParkingManager.findNearestSlot(vehicleType, requiresAccessible);
        }

        if (!targetSlot) {
          UI.showToast(`No available slot suitable for ${vehicleType.toUpperCase()} at this time.`, 'error');
          return;
        }

        try {
          const ticket = ParkingManager.assignSlot(targetSlot.id, cleanPlate, vehicleType);
          UI.showToast(`Assigned nearest slot ${targetSlot.id} to ${cleanPlate}!`, 'success');

          // Reset form
          entryForm.reset();
          if (slotOverride) slotOverride.value = '';

          // Show Ticket with Canvas QR
          UI.showTicketModal(ticket);

          // Update UI
          UI.renderParkingMap(targetSlot.floor);
          UI.renderDashboardKPIs();
          UI.animateCarDrive(targetSlot.id, 'entry');
        } catch (err) {
          UI.showToast(err.message, 'error');
        }
      });

      // Quick entry preset chips
      document.querySelectorAll('.quick-entry-chip').forEach((btn) => {
        btn.addEventListener('click', () => {
          const plate = btn.getAttribute('data-plate');
          const type = btn.getAttribute('data-type');
          const plateInput = document.getElementById('entryPlateInput');
          const typeSelect = document.getElementById('entryTypeSelect');
          if (plateInput) plateInput.value = plate;
          if (typeSelect) typeSelect.value = type;
        });
      });
    }

    // 2. VEHICLE EXIT & BILLING SEARCH / SCAN
    const exitSearchBtn = document.getElementById('exitSearchBtn');
    const exitSearchInput = document.getElementById('exitSearchInput');
    const exitCheckoutCard = document.getElementById('exitCheckoutCard');

    const handleExitLookup = () => {
      const query = (exitSearchInput?.value || '').trim().toUpperCase();
      if (!query) {
        UI.showToast('Please enter a Ticket ID or License Plate.', 'warning');
        return;
      }

      const ticketMap = Storage.getTicketMap();
      const plateMap = Storage.getPlateMap();

      let activeTicket = ticketMap.get(query) || plateMap.get(query);

      // If not active, check if user requested lost ticket
      const lostTicketCheck = document.getElementById('lostTicketCheck')?.checked;

      if (!activeTicket && !lostTicketCheck) {
        UI.showToast(`No active vehicle found matching "${query}".`, 'error');
        if (exitCheckoutCard) exitCheckoutCard.classList.add('hidden');
        return;
      }

      const entryTime = activeTicket ? activeTicket.entryTime : Date.now() - 3 * 3600000;
      const vehicleType = activeTicket ? activeTicket.type : 'car';
      const plate = activeTicket ? activeTicket.plate : query;
      const slotId = activeTicket ? activeTicket.slotId : 'N/A';

      // Calculate Real-Time Fee
      const calculation = BillingEngine.calculateFee({
        entryTime,
        exitTime: Date.now(),
        vehicleType,
        isLostTicket: lostTicketCheck,
      });

      // Populate Checkout Review Box
      if (exitCheckoutCard) {
        exitCheckoutCard.classList.remove('hidden');
        document.getElementById('checkoutTicketId').textContent = activeTicket ? activeTicket.ticketId : 'LOST-TICKET';
        document.getElementById('checkoutPlate').textContent = plate;
        document.getElementById('checkoutSlot').textContent = slotId;
        document.getElementById('checkoutDuration').textContent = `${calculation.totalHoursRaw} hrs (${calculation.totalMinutes} mins)`;
        document.getElementById('checkoutRate').textContent = `$${calculation.baseRatePerHour.toFixed(2)}/hr`;
        document.getElementById('checkoutBaseTotal').textContent = `$${calculation.baseSubtotal.toFixed(2)}`;
        document.getElementById('checkoutFinalTotal').textContent = `$${calculation.finalTotal.toFixed(2)}`;

        // Surge and discount indicators
        const surgeLine = document.getElementById('checkoutSurgeLine');
        if (surgeLine) {
          if (calculation.surgeAdjustmentAmount !== 0) {
            surgeLine.classList.remove('hidden');
            surgeLine.textContent = calculation.surgeMultiplier > 1 
              ? `Surge pricing (+${Math.round((calculation.surgeMultiplier - 1) * 100)}%): +$${calculation.surgeAdjustmentAmount.toFixed(2)}`
              : `Off-peak discount (-${Math.round((1 - calculation.surgeMultiplier) * 100)}%): -$${Math.abs(calculation.surgeAdjustmentAmount).toFixed(2)}`;
          } else {
            surgeLine.classList.add('hidden');
          }
        }

        // Store active lookup context on confirm button
        const confirmBtn = document.getElementById('confirmPaymentBtn');
        if (confirmBtn) {
          confirmBtn.setAttribute('data-ticket-id', activeTicket ? activeTicket.ticketId : 'LOST');
          confirmBtn.setAttribute('data-slot-id', slotId);
        }
      }
    };

    exitSearchBtn?.addEventListener('click', handleExitLookup);
    exitSearchInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleExitLookup();
    });

    // Confirm Payment & Exit Checkout
    const confirmPaymentBtn = document.getElementById('confirmPaymentBtn');
    if (confirmPaymentBtn) {
      confirmPaymentBtn.addEventListener('click', (e) => {
        const ticketId = e.currentTarget.getAttribute('data-ticket-id');
        const slotId = e.currentTarget.getAttribute('data-slot-id');
        const paymentMethod = document.querySelector('input[name="paymentMethod"]:checked')?.value || 'card';
        const isLostTicket = document.getElementById('lostTicketCheck')?.checked || false;

        try {
          const receipt = BillingEngine.processCheckout({
            ticketId,
            paymentMethod,
            isLostTicket,
          });

          UI.showToast(`Payment of $${receipt.fee.toFixed(2)} completed! Barrier raised.`, 'success');

          // Animate car exiting
          if (slotId && slotId !== 'N/A') {
            UI.animateCarDrive(slotId, 'exit');
          }

          // Reset checkout view
          if (exitCheckoutCard) exitCheckoutCard.classList.add('hidden');
          if (exitSearchInput) exitSearchInput.value = '';

          // Show printable receipt modal
          UI.showReceiptModal(receipt);

          // Update Map and KPIs
          UI.renderParkingMap();
          UI.renderDashboardKPIs();
          ChartRenderer.refreshAll();
        } catch (err) {
          UI.showToast(err.message, 'error');
        }
      });
    }

    // 3. RESERVATION FORM
    const reservationForm = document.getElementById('newReservationForm');
    if (reservationForm) {
      reservationForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const driverName = document.getElementById('resDriverName').value.trim();
        const plate = document.getElementById('resPlate').value.trim().toUpperCase();
        const type = document.getElementById('resType').value;
        const slotSelect = document.getElementById('resSlotSelect').value;
        const dateVal = document.getElementById('resDate').value;
        const startVal = document.getElementById('resStartTime').value;
        const endVal = document.getElementById('resEndTime').value;

        if (!driverName || !plate || !dateVal || !startVal || !endVal) {
          UI.showToast('Please complete all reservation fields.', 'warning');
          return;
        }

        const startTimestamp = new Date(`${dateVal}T${startVal}`).getTime();
        const endTimestamp = new Date(`${dateVal}T${endVal}`).getTime();

        if (endTimestamp <= startTimestamp) {
          UI.showToast('End time must be after start time.', 'error');
          return;
        }

        // Interval Collision Detection
        const collisionCheck = ParkingManager.checkReservationCollision(slotSelect, startTimestamp, endTimestamp);
        if (collisionCheck.conflict) {
          UI.showToast(collisionCheck.reason, 'error');
          return;
        }

        // Create confirmed reservation
        const resId = `RES-${Date.now().toString(36).toUpperCase()}`;
        const newReservation = {
          id: resId,
          slotId: slotSelect,
          plate,
          type,
          driverName,
          startTime: startTimestamp,
          endTime: endTimestamp,
          status: 'confirmed',
          createdAt: Date.now(),
        };

        Storage.addReservation(newReservation);
        Storage.updateSlot(slotSelect, { status: 'reserved' });

        UI.showToast(`Reservation ${resId} confirmed for slot ${slotSelect}!`, 'success');
        reservationForm.reset();
        UI.renderReservations();
        UI.renderParkingMap();
        UI.renderDashboardKPIs();
      });
    }

    // Populate reservation slot select options
    this.populateReservationSlotOptions();

    // 4. ACTIVITY FILTER & SEARCH LISTENERS
    const activitySearch = document.getElementById('activitySearchInput');
    const typeFilter = document.getElementById('activityTypeFilter');
    const statusFilter = document.getElementById('activityStatusFilter');
    const floorFilter = document.getElementById('activityFloorFilter');
    const exportCsvBtn = document.getElementById('exportCsvBtn');

    activitySearch?.addEventListener('input', (e) => {
      UI.activeFilter.search = e.target.value;
      UI.renderActivityTable();
    });

    typeFilter?.addEventListener('change', (e) => {
      UI.activeFilter.type = e.target.value;
      UI.renderActivityTable();
    });

    statusFilter?.addEventListener('change', (e) => {
      UI.activeFilter.status = e.target.value;
      UI.renderActivityTable();
    });

    floorFilter?.addEventListener('change', (e) => {
      UI.activeFilter.floor = e.target.value;
      UI.renderActivityTable();
    });

    exportCsvBtn?.addEventListener('click', () => {
      UI.exportActivityCSV();
    });

    // Table Header Sorting
    document.querySelectorAll('.table-sort-header').forEach((th) => {
      th.addEventListener('click', () => {
        const sortBy = th.getAttribute('data-sort-col');
        if (UI.activeFilter.sortBy === sortBy) {
          UI.activeFilter.sortDir = UI.activeFilter.sortDir === 'asc' ? 'desc' : 'asc';
        } else {
          UI.activeFilter.sortBy = sortBy;
          UI.activeFilter.sortDir = 'asc';
        }
        UI.renderActivityTable();
      });
    });

    // 5. PREDICTION QUERY FORM
    const predDaySelect = document.getElementById('predDaySelect');
    const predHourSelect = document.getElementById('predHourSelect');
    predDaySelect?.addEventListener('change', () => UI.renderPredictionCalculator());
    predHourSelect?.addEventListener('change', () => UI.renderPredictionCalculator());

    // 6. SETTINGS FORM (ADMIN)
    const settingsForm = document.getElementById('systemSettingsForm');
    if (settingsForm) {
      // Load current settings into inputs
      this.populateSettingsForm();

      settingsForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const settings = {
          rates: {
            bike: parseFloat(document.getElementById('settingRateBike').value) || 1.5,
            car: parseFloat(document.getElementById('settingRateCar').value) || 3.0,
            suv: parseFloat(document.getElementById('settingRateSuv').value) || 4.5,
            ev: parseFloat(document.getElementById('settingRateEv').value) || 4.0,
          },
          dailyCaps: {
            bike: parseFloat(document.getElementById('settingCapBike').value) || 12.0,
            car: parseFloat(document.getElementById('settingCapCar').value) || 25.0,
            suv: parseFloat(document.getElementById('settingCapSuv').value) || 35.0,
            ev: parseFloat(document.getElementById('settingCapEv').value) || 32.0,
          },
          gracePeriodMinutes: parseInt(document.getElementById('settingGraceMins').value, 10) || 10,
          nightDiscountPercent: parseInt(document.getElementById('settingNightDiscount').value, 10) || 20,
          overstayPenaltyFlat: parseFloat(document.getElementById('settingOverstayPenalty').value) || 10.0,
          overstayThresholdHours: parseInt(document.getElementById('settingOverstayHours').value, 10) || 12,
          lostTicketFine: parseFloat(document.getElementById('settingLostTicketFine').value) || 30.0,
          surgeThresholdHigh: parseInt(document.getElementById('settingSurgeHigh').value, 10) || 80,
          surgeThresholdLow: parseInt(document.getElementById('settingSurgeLow').value, 10) || 30,
          surgeMultiplierHigh: 1.2,
          surgeMultiplierLow: 0.9,
          reservationGraceMinutes: 15,
        };

        Storage.saveSettings(settings);
        UI.showToast('System configuration & pricing rules updated successfully.', 'success');
        UI.renderSurgeBadge();
        UI.renderDashboardKPIs();
      });
    }

    // Reset Demo Data Button
    document.getElementById('resetDemoDataBtn')?.addEventListener('click', () => {
      if (confirm('Reset ParkSense database to realistic demo seed data? This restores all 60 slots and 7-day history.')) {
        Storage.resetAll();
        UI.showToast('ParkSense demo data restored to pristine initial state.', 'success');
        UI.renderDashboardKPIs();
        UI.renderParkingMap(1);
        UI.renderReservations();
        UI.renderActivityTable();
        ChartRenderer.refreshAll();
      }
    });
  }

  populateReservationSlotOptions() {
    const select = document.getElementById('resSlotSelect');
    if (!select) return;

    const slots = Storage.getSlots();
    select.innerHTML = slots
      .map(
        (s) => `<option value="${s.id}">Slot ${s.id} (L${s.floor} - ${s.type.toUpperCase()}${s.isEv ? ' [EV]' : ''})</option>`
      )
      .join('');
  }

  populateSettingsForm() {
    const s = Storage.getSettings();
    const setVal = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.value = val;
    };

    setVal('settingRateBike', s.rates?.bike ?? 1.5);
    setVal('settingRateCar', s.rates?.car ?? 3.0);
    setVal('settingRateSuv', s.rates?.suv ?? 4.5);
    setVal('settingRateEv', s.rates?.ev ?? 4.0);

    setVal('settingCapBike', s.dailyCaps?.bike ?? 12.0);
    setVal('settingCapCar', s.dailyCaps?.car ?? 25.0);
    setVal('settingCapSuv', s.dailyCaps?.suv ?? 35.0);
    setVal('settingCapEv', s.dailyCaps?.ev ?? 32.0);

    setVal('settingGraceMins', s.gracePeriodMinutes ?? 10);
    setVal('settingNightDiscount', s.nightDiscountPercent ?? 20);
    setVal('settingOverstayPenalty', s.overstayPenaltyFlat ?? 10.0);
    setVal('settingOverstayHours', s.overstayThresholdHours ?? 12);
    setVal('settingLostTicketFine', s.lostTicketFine ?? 30.0);
    setVal('settingSurgeHigh', s.surgeThresholdHigh ?? 80);
    setVal('settingSurgeLow', s.surgeThresholdLow ?? 30);
  }

  /**
   * Module 5: Live Simulation Mode
   * Periodically spawns realistic arrivals or departures every 3-5 seconds.
   */
  setupSimulation() {
    const toggle = document.getElementById('simulationToggle');
    const badge = document.getElementById('simStatusBadge');
    if (!toggle) return;

    toggle.addEventListener('change', (e) => {
      this.simulationActive = e.target.checked;
      if (this.simulationActive) {
        if (badge) {
          badge.textContent = 'SIMULATION ACTIVE';
          badge.className = 'px-2 py-0.5 text-[10px] font-mono rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 animate-pulse';
        }
        UI.showToast('Live traffic simulation started: arrivals & exits occurring automatically.', 'info');
        this.startSimulationLoop();
      } else {
        if (badge) {
          badge.textContent = 'SIMULATION IDLE';
          badge.className = 'px-2 py-0.5 text-[10px] font-mono rounded bg-slate-800 text-slate-400 border border-slate-700';
        }
        UI.showToast('Live traffic simulation paused.', 'info');
        clearInterval(this.simulationInterval);
        this.simulationInterval = null;
      }
    });
  }

  startSimulationLoop() {
    clearInterval(this.simulationInterval);

    this.simulationInterval = setInterval(() => {
      if (!this.simulationActive) return;

      const slots = Storage.getSlots();
      const freeSlots = slots.filter((s) => s.status === 'free');
      const occupiedSlots = slots.filter((s) => s.status === 'occupied' || s.status === 'ev_charging');

      // 60% chance of arrival if slots available, 40% chance of departure
      const shouldArrive = freeSlots.length > 3 && (Math.random() < 0.6 || occupiedSlots.length === 0);

      if (shouldArrive) {
        // Vehicle Arrival Simulation
        const vehicleTypes = ['car', 'car', 'suv', 'ev', 'bike'];
        const chosenType = vehicleTypes[Math.floor(Math.random() * vehicleTypes.length)];
        const states = ['CA', 'NY', 'TX', 'WA', 'FL', 'IL', 'MA', 'OH'];
        const state = states[Math.floor(Math.random() * states.length)];
        const plate = `${state}-${Math.floor(1000 + Math.random() * 9000)}`;

        const slot = ParkingManager.findNearestSlot(chosenType, false);
        if (slot) {
          try {
            const ticket = ParkingManager.assignSlot(slot.id, plate, chosenType);
            UI.renderParkingMap();
            UI.renderDashboardKPIs();
            UI.animateCarDrive(slot.id, 'entry');
            UI.showToast(`Simulated arrival: ${chosenType.toUpperCase()} ${plate} parked in ${slot.id}`, 'info');
          } catch {}
        }
      } else if (occupiedSlots.length > 0) {
        // Vehicle Exit Simulation
        const targetSlot = occupiedSlots[Math.floor(Math.random() * occupiedSlots.length)];
        const ticketId = targetSlot.currentVehicle?.ticketId;
        const methods = ['card', 'wallet', 'cash'];
        const paymentMethod = methods[Math.floor(Math.random() * methods.length)];

        if (ticketId) {
          try {
            const receipt = BillingEngine.processCheckout({ ticketId, paymentMethod });
            UI.renderParkingMap();
            UI.renderDashboardKPIs();
            UI.animateCarDrive(targetSlot.id, 'exit');
            UI.showToast(`Simulated exit: ${receipt.plate} exited slot ${receipt.slotId} ($${receipt.fee.toFixed(2)})`, 'success');
          } catch {}
        }
      }

      // Refresh canvas charts periodically during simulation
      ChartRenderer.refreshAll();
    }, 4200);
  }

  /**
   * System timers: Live clock, 15-minute reservation auto-release countdowns, and KPI updates.
   */
  startSystemTimers() {
    // 1. Top bar live clock and date
    const clockEl = document.getElementById('systemLiveClock');
    const updateClock = () => {
      if (clockEl) {
        const d = new Date();
        clockEl.textContent = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      }
    };
    updateClock();
    this.clockInterval = setInterval(updateClock, 1000);

    const dateEl = document.getElementById('systemDateDisplay');
    if (dateEl) {
      const now = new Date();
      const dd = String(now.getDate()).padStart(2, '0');
      const mm = String(now.getMonth() + 1).padStart(2, '0');
      const yyyy = now.getFullYear();
      dateEl.textContent = `${dd}/${mm}/${yyyy}`;
    }

    // 2. Reservation no-show auto-release checker (every 10 seconds)
    this.countdownInterval = setInterval(() => {
      ParkingManager.checkReservationNoShows();
      if (document.getElementById('reservationsSection') && !document.getElementById('reservationsSection').classList.contains('hidden')) {
        UI.renderReservations();
      }
    }, 10000);
  }
}

// Instantiate and initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  const app = new ParkSenseApp();
  app.init();
});
