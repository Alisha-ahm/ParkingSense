/**
 * ParkSense - Storage Module
 * Database layer using browser localStorage with seed data generation.
 * Handles slots, active tickets, reservations, vehicle history, analytics logs, and settings.
 */

const STORAGE_KEYS = {
  SLOTS: 'parksense_slots',
  TICKETS: 'parksense_tickets',
  RESERVATIONS: 'parksense_reservations',
  HISTORY: 'parksense_history',
  NOTIFICATIONS: 'parksense_notifications',
  SETTINGS: 'parksense_settings',
  ANALYTICS_HISTORY: 'parksense_analytics_history',
  CURRENT_ROLE: 'parksense_current_role',
};

// Default system pricing and rules settings
export const DEFAULT_SETTINGS = {
  rates: {
    bike: 1.5,
    car: 3.0,
    suv: 4.5,
    ev: 4.0,
  },
  dailyCaps: {
    bike: 12.0,
    car: 25.0,
    suv: 35.0,
    ev: 32.0,
  },
  gracePeriodMinutes: 10,
  nightDiscountPercent: 20, // 10 PM to 6 AM
  overstayPenaltyFlat: 10.0,
  overstayThresholdHours: 12,
  lostTicketFine: 30.0,
  surgeThresholdHigh: 80, // % occupancy for +20%
  surgeThresholdLow: 30, // % occupancy for -10%
  surgeMultiplierHigh: 1.2,
  surgeMultiplierLow: 0.9,
  reservationGraceMinutes: 15, // no-show auto-release
};

/**
 * Generates initial 60 slots across 3 floors (20 per floor).
 * Floor 1: Ground floor (closest to entry, mix of accessible, EV, car, bike)
 * Floor 2: Mid level (standard car, SUV, EV)
 * Floor 3: Rooftop / Upper level (standard car, SUV, bike)
 */
function generateInitialSlots() {
  const slots = [];
  const floors = [1, 2, 3];

  floors.forEach((floor) => {
    for (let s = 1; s <= 20; s++) {
      const slotNumStr = s < 10 ? `0${s}` : `${s}`;
      const id = `F${floor}-S${slotNumStr}`;
      
      // Determine slot type and features
      let type = 'car';
      let isAccessible = false;
      let isEv = false;

      if (floor === 1 && s <= 3) {
        isAccessible = true;
        type = 'car';
      } else if (s === 4 || s === 5 || s === 14) {
        type = 'ev';
        isEv = true;
      } else if (s === 6 || s === 7 || s === 8) {
        type = 'bike';
      } else if (s >= 16) {
        type = 'suv';
      }

      // Slot grid coordinates for distance calculation and map visual layout
      // Row 1 (1-10) and Row 2 (11-20), separated by a central driving lane
      const row = s <= 10 ? 1 : 2;
      const col = s <= 10 ? s : s - 10;

      // Distance metric from entrance (Entrance is at Floor 1, Row 1, Col 1)
      // Floor penalty: 15 units per floor elevation
      // Row penalty: 4 units
      // Col distance: col * 2 units
      const distance = Math.round(
        Math.sqrt(Math.pow((floor - 1) * 15, 2) + Math.pow((row - 1) * 4, 2) + Math.pow((col - 1) * 2, 2)) * 10
      ) / 10;

      slots.push({
        id,
        floor,
        number: s,
        row,
        col,
        distance,
        type, // 'car' | 'suv' | 'bike' | 'ev'
        isAccessible,
        isEv,
        status: 'free', // 'free' | 'occupied' | 'reserved' | 'out_of_service'
        currentVehicle: null, // { plate, type, ticketId, entryTime }
        updatedAt: Date.now(),
      });
    }
  });

  return slots;
}

/**
 * Generates realistic seed data for active tickets, completed history, and reservations.
 */
function generateSeedData() {
  const slots = generateInitialSlots();
  const now = Date.now();
  const HOUR = 3600 * 1000;
  const MIN = 60 * 1000;

  const samplePlates = [
    { plate: 'ABC-4821', type: 'car', hoursAgo: 2.4 },
    { plate: 'NY-8839', type: 'suv', hoursAgo: 1.1 },
    { plate: 'EV-3029', type: 'ev', hoursAgo: 3.5 },
    { plate: 'BK-1092', type: 'bike', hoursAgo: 0.8 },
    { plate: 'TEX-9012', type: 'car', hoursAgo: 4.2 },
    { plate: 'CAL-5521', type: 'car', hoursAgo: 5.7 },
    { plate: 'WA-7740', type: 'suv', hoursAgo: 1.8 },
    { plate: 'EV-9901', type: 'ev', hoursAgo: 0.5 },
    { plate: 'FL-2341', type: 'car', hoursAgo: 6.2 },
    { plate: 'IL-6612', type: 'car', hoursAgo: 2.1 },
    { plate: 'BOS-4411', type: 'bike', hoursAgo: 1.5 },
    { plate: 'MIA-8820', type: 'suv', hoursAgo: 0.3 },
    { plate: 'OR-1190', type: 'car', hoursAgo: 7.9 },
    { plate: 'AZ-3329', type: 'car', hoursAgo: 3.1 },
    { plate: 'NV-7711', type: 'suv', hoursAgo: 2.0 },
    { plate: 'COL-6644', type: 'ev', hoursAgo: 4.0 },
    { plate: 'GA-9912', type: 'car', hoursAgo: 8.5 },
    { plate: 'NC-4401', type: 'car', hoursAgo: 1.2 },
    { plate: 'OH-7722', type: 'suv', hoursAgo: 0.9 },
    { plate: 'PA-3390', type: 'bike', hoursAgo: 2.8 },
    { plate: 'VA-8811', type: 'car', hoursAgo: 14.5 }, // Overstay vehicle (> 12 hrs)
  ];

  const tickets = [];
  let plateIdx = 0;

  // Occupy ~21 slots
  for (let i = 0; i < slots.length && plateIdx < samplePlates.length; i++) {
    const slot = slots[i];
    const item = samplePlates[plateIdx];

    // Check suitability
    const matches =
      (item.type === 'ev' && slot.isEv) ||
      (item.type === 'bike' && slot.type === 'bike') ||
      (item.type === 'suv' && (slot.type === 'suv' || slot.type === 'car')) ||
      (item.type === 'car' && (slot.type === 'car' || slot.type === 'suv'));

    if (matches && slot.status === 'free') {
      const ticketId = `TCK-${slot.id}-${Math.floor(1000 + Math.random() * 9000)}`;
      const entryTime = now - Math.round(item.hoursAgo * HOUR);

      slot.status = item.type === 'ev' ? 'ev_charging' : 'occupied';
      slot.currentVehicle = {
        plate: item.plate,
        type: item.type,
        ticketId,
        entryTime,
        slotId: slot.id,
      };

      tickets.push({
        ticketId,
        slotId: slot.id,
        floor: slot.floor,
        plate: item.plate,
        type: item.type,
        entryTime,
        status: 'active',
        isOverstay: item.hoursAgo > 12,
      });

      plateIdx++;
    }
  }

  // Put 2 slots in maintenance/out of service
  const outOfServiceSlot1 = slots.find((s) => s.id === 'F2-S15');
  if (outOfServiceSlot1) outOfServiceSlot1.status = 'out_of_service';
  const outOfServiceSlot2 = slots.find((s) => s.id === 'F3-S10');
  if (outOfServiceSlot2) outOfServiceSlot2.status = 'out_of_service';

  // Create sample reservations
  const reservations = [
    {
      id: 'RES-01',
      slotId: 'F1-S01',
      plate: 'RES-VIP1',
      type: 'car',
      driverName: 'Elena Rostova',
      startTime: now + 30 * MIN,
      endTime: now + 150 * MIN,
      status: 'confirmed',
      createdAt: now - 60 * MIN,
    },
    {
      id: 'RES-02',
      slotId: 'F2-S04',
      plate: 'TESLA-88',
      type: 'ev',
      driverName: 'Marcus Vance',
      startTime: now - 5 * MIN, // within 15 min grace
      endTime: now + 180 * MIN,
      status: 'confirmed',
      createdAt: now - 120 * MIN,
    },
    {
      id: 'RES-03',
      slotId: 'F3-S18',
      plate: 'SUV-9921',
      type: 'suv',
      driverName: 'Sarah Jenkins',
      startTime: now + 90 * MIN,
      endTime: now + 240 * MIN,
      status: 'confirmed',
      createdAt: now - 15 * MIN,
    },
  ];

  // Mark reserved slot status
  const reservedSlot = slots.find((s) => s.id === 'F2-S04');
  if (reservedSlot && reservedSlot.status === 'free') {
    reservedSlot.status = 'reserved';
  }

  // Generate 35 past completed vehicle histories over the last 3 days
  const history = [];
  const paymentMethods = ['card', 'wallet', 'cash'];
  const vehicleTypes = ['car', 'suv', 'ev', 'bike'];
  const pastPlates = [
    'TX-4921', 'CA-1029', 'IL-3392', 'FL-8812', 'NY-5501', 'WA-2910', 'OH-9014',
    'MA-3318', 'GA-7719', 'NC-4402', 'MI-1102', 'CO-8831', 'AZ-5591', 'NV-2234',
    'VA-6671', 'PA-8890', 'OR-3312', 'MO-4491', 'MD-7712', 'TN-1194', 'IN-5502',
    'WI-8823', 'MN-4492', 'SC-7714', 'AL-9901', 'LA-3321', 'KY-6672', 'OK-1182',
    'UT-5592', 'CT-3381', 'IA-8812', 'AR-4491', 'MS-2281', 'KS-7719', 'NM-3390',
  ];

  pastPlates.forEach((plate, i) => {
    const vType = vehicleTypes[i % vehicleTypes.length];
    const durationHours = Math.round((0.5 + (i * 0.4) % 6.5) * 10) / 10;
    const exitTime = now - (i * 2.1 * HOUR + 20 * MIN);
    const entryTime = exitTime - Math.round(durationHours * HOUR);
    
    // Fee calculation rough model
    let baseRate = vType === 'bike' ? 1.5 : vType === 'car' ? 3.0 : vType === 'suv' ? 4.5 : 4.0;
    let fee = Math.round(durationHours * baseRate * 100) / 100;
    if (durationHours > 8) fee = Math.min(fee, 25); // cap

    history.push({
      id: `HIST-${1000 + i}`,
      ticketId: `TCK-F${(i % 3) + 1}-S${(i % 20) + 1}-${2000 + i}`,
      slotId: `F${(i % 3) + 1}-S${(i % 20) + 1 < 10 ? '0' : ''}${(i % 20) + 1}`,
      floor: (i % 3) + 1,
      plate,
      type: vType,
      entryTime,
      exitTime,
      durationHours,
      fee,
      paymentMethod: paymentMethods[i % paymentMethods.length],
      status: 'completed',
    });
  });

  // Notifications seed
  const notifications = [
    {
      id: 'NOTIF-1',
      type: 'warning',
      title: 'High Occupancy Alert',
      message: 'Level 1 occupancy reached 85%. Dynamic surge pricing +20% activated.',
      timestamp: now - 22 * MIN,
      read: false,
    },
    {
      id: 'NOTIF-2',
      type: 'alert',
      title: 'Overstay Detected',
      message: 'Vehicle VA-8811 in slot F1-S19 has exceeded 14 hours.',
      timestamp: now - 45 * MIN,
      read: false,
    },
    {
      id: 'NOTIF-3',
      type: 'info',
      title: 'Reservation Window Active',
      message: 'Reservation RES-02 for TESLA-88 is ready at F2-S04.',
      timestamp: now - 5 * MIN,
      read: true,
    },
    {
      id: 'NOTIF-4',
      type: 'success',
      title: 'Payment Received',
      message: 'Payment of $13.50 confirmed for Ticket TCK-F2-S11-3829 (Card).',
      timestamp: now - 62 * MIN,
      read: true,
    },
  ];

  // 7-day hourly analytics log for predictions and canvas charts
  const analyticsHistory = generatePast7DaysAnalytics(now);

  return {
    slots,
    tickets,
    reservations,
    history,
    notifications,
    analyticsHistory,
    settings: DEFAULT_SETTINGS,
    role: 'admin',
  };
}

/**
 * Generates historical hourly occupancy records for the past 7 days (0 to 6 days ago).
 * Each day has 24 hourly data points (00:00 to 23:00) with realistic diurnal curves.
 */
function generatePast7DaysAnalytics(now) {
  const records = [];
  const DAY_MS = 24 * 3600 * 1000;

  for (let d = 6; d >= 0; d--) {
    const dayDate = new Date(now - d * DAY_MS);
    const dayOfWeek = dayDate.getDay(); // 0 = Sun, 1 = Mon ... 6 = Sat
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

    for (let h = 0; h < 24; h++) {
      // Natural parking demand curve:
      // Morning rush: 8-10 AM
      // Lunch peak: 12-14 PM
      // Evening peak: 17-19 PM
      // Night calm: 23-06 AM
      let baseFactor = 0.15; // night baseline ~15%

      if (h >= 7 && h <= 10) {
        baseFactor = isWeekend ? 0.35 : 0.72; // weekday morning rush
      } else if (h >= 11 && h <= 14) {
        baseFactor = isWeekend ? 0.65 : 0.82; // lunch
      } else if (h >= 15 && h <= 19) {
        baseFactor = isWeekend ? 0.78 : 0.88; // evening peak
      } else if (h >= 20 && h <= 22) {
        baseFactor = isWeekend ? 0.55 : 0.42;
      }

      // Add small deterministic variance
      const variance = (((h * 17 + d * 31) % 13) - 6) * 0.015;
      const occupancyRate = Math.min(0.96, Math.max(0.1, baseFactor + variance));
      const occupiedSlots = Math.round(occupancyRate * 60);

      records.push({
        dayOffset: d,
        dayOfWeek,
        dateStr: dayDate.toISOString().split('T')[0],
        hour: h,
        occupiedSlots,
        totalSlots: 60,
        occupancyRate: Math.round(occupancyRate * 100),
        revenue: Math.round(occupiedSlots * (2.8 + ((h + d) % 4) * 0.4) * 10) / 10,
      });
    }
  }

  return records;
}

/**
 * Storage Service - API for interacting with localStorage.
 */
export const Storage = {
  init() {
    const existing = localStorage.getItem(STORAGE_KEYS.SLOTS);
    if (!existing) {
      this.resetAll();
    }
  },

  resetAll() {
    const seed = generateSeedData();
    localStorage.setItem(STORAGE_KEYS.SLOTS, JSON.stringify(seed.slots));
    localStorage.setItem(STORAGE_KEYS.TICKETS, JSON.stringify(seed.tickets));
    localStorage.setItem(STORAGE_KEYS.RESERVATIONS, JSON.stringify(seed.reservations));
    localStorage.setItem(STORAGE_KEYS.HISTORY, JSON.stringify(seed.history));
    localStorage.setItem(STORAGE_KEYS.NOTIFICATIONS, JSON.stringify(seed.notifications));
    localStorage.setItem(STORAGE_KEYS.ANALYTICS_HISTORY, JSON.stringify(seed.analyticsHistory));
    localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(seed.settings));
    localStorage.setItem(STORAGE_KEYS.CURRENT_ROLE, seed.role);
    try { localStorage.removeItem('parksense_theme'); } catch (_) {}
    return seed;
  },

  // Slots
  getSlots() {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.SLOTS);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  },

  saveSlots(slots) {
    localStorage.setItem(STORAGE_KEYS.SLOTS, JSON.stringify(slots));
  },

  updateSlot(slotId, partial) {
    const slots = this.getSlots();
    const idx = slots.findIndex((s) => s.id === slotId);
    if (idx !== -1) {
      slots[idx] = { ...slots[idx], ...partial, updatedAt: Date.now() };
      this.saveSlots(slots);
      return slots[idx];
    }
    return null;
  },

  // Active Tickets
  getTickets() {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.TICKETS);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  },

  saveTickets(tickets) {
    localStorage.setItem(STORAGE_KEYS.TICKETS, JSON.stringify(tickets));
  },

  addTicket(ticket) {
    const tickets = this.getTickets();
    tickets.unshift(ticket);
    this.saveTickets(tickets);
  },

  removeTicket(ticketId) {
    const tickets = this.getTickets();
    const filtered = tickets.filter((t) => t.ticketId !== ticketId);
    this.saveTickets(filtered);
  },

  // Fast Hash Maps for O(1) lookups
  getTicketMap() {
    const tickets = this.getTickets();
    const map = new Map();
    tickets.forEach((t) => map.set(t.ticketId, t));
    return map;
  },

  getPlateMap() {
    const tickets = this.getTickets();
    const map = new Map();
    tickets.forEach((t) => map.set(t.plate.toUpperCase().trim(), t));
    return map;
  },

  // Reservations
  getReservations() {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.RESERVATIONS);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  },

  saveReservations(reservations) {
    localStorage.setItem(STORAGE_KEYS.RESERVATIONS, JSON.stringify(reservations));
  },

  addReservation(res) {
    const list = this.getReservations();
    list.unshift(res);
    this.saveReservations(list);
  },

  updateReservation(id, partial) {
    const list = this.getReservations();
    const idx = list.findIndex((r) => r.id === id);
    if (idx !== -1) {
      list[idx] = { ...list[idx], ...partial };
      this.saveReservations(list);
      return list[idx];
    }
    return null;
  },

  // Vehicle History
  getHistory() {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.HISTORY);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  },

  addHistory(entry) {
    const list = this.getHistory();
    list.unshift(entry);
    localStorage.setItem(STORAGE_KEYS.HISTORY, JSON.stringify(list));
  },

  // Notifications
  getNotifications() {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.NOTIFICATIONS);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  },

  addNotification(notif) {
    const list = this.getNotifications();
    const newNotif = {
      id: `NOTIF-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      timestamp: Date.now(),
      read: false,
      ...notif,
    };
    list.unshift(newNotif);
    localStorage.setItem(STORAGE_KEYS.NOTIFICATIONS, JSON.stringify(list.slice(0, 50))); // Keep last 50
    return newNotif;
  },

  markNotificationsRead() {
    const list = this.getNotifications();
    list.forEach((n) => (n.read = true));
    localStorage.setItem(STORAGE_KEYS.NOTIFICATIONS, JSON.stringify(list));
  },

  // Settings
  getSettings() {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.SETTINGS);
      return data ? JSON.parse(data) : DEFAULT_SETTINGS;
    } catch {
      return DEFAULT_SETTINGS;
    }
  },

  saveSettings(settings) {
    localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
  },

  // Analytics History
  getAnalyticsHistory() {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.ANALYTICS_HISTORY);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  },

  saveAnalyticsHistory(records) {
    localStorage.setItem(STORAGE_KEYS.ANALYTICS_HISTORY, JSON.stringify(records));
  },

  // Role
  getRole() {
    return localStorage.getItem(STORAGE_KEYS.CURRENT_ROLE) || 'admin';
  },

  setRole(role) {
    localStorage.setItem(STORAGE_KEYS.CURRENT_ROLE, role);
  },

  getTheme() {
    return 'light';
  },
};
