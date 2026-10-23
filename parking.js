/**
 * ParkSense - Parking Module
 * Handles nearest-slot allocation via Min-Heap / Priority Queue,
 * interval overlap collision checking for reservations, ticket generation,
 * plate format validation, and Canvas QR-code matrix rendering.
 */

import { Storage } from './storage.js';

/**
 * Min-Heap (Priority Queue) Implementation
 * Used for nearest-slot allocation ordered by distance from entrance.
 *
 * TIME COMPLEXITIES:
 * - Insertion: O(log N)
 * - Extract-Min (pop): O(log N)
 * - Heapify / Construction: O(N)
 * - Space Complexity: O(N)
 */
export class MinHeap {
  constructor(compareFn = (a, b) => a.distance - b.distance) {
    this.heap = [];
    this.compare = compareFn;
  }

  size() {
    return this.heap.length;
  }

  isEmpty() {
    return this.heap.length === 0;
  }

  peek() {
    return this.heap[0] || null;
  }

  insert(node) {
    this.heap.push(node);
    this._bubbleUp(this.heap.length - 1);
  }

  extractMin() {
    if (this.isEmpty()) return null;
    if (this.heap.length === 1) return this.heap.pop();

    const min = this.heap[0];
    this.heap[0] = this.heap.pop();
    this._sinkDown(0);
    return min;
  }

  _bubbleUp(index) {
    while (index > 0) {
      const parentIndex = Math.floor((index - 1) / 2);
      if (this.compare(this.heap[index], this.heap[parentIndex]) < 0) {
        [this.heap[index], this.heap[parentIndex]] = [this.heap[parentIndex], this.heap[index]];
        index = parentIndex;
      } else {
        break;
      }
    }
  }

  _sinkDown(index) {
    const length = this.heap.length;
    while (true) {
      const left = 2 * index + 1;
      const right = 2 * index + 2;
      let smallest = index;

      if (left < length && this.compare(this.heap[left], this.heap[smallest]) < 0) {
        smallest = left;
      }
      if (right < length && this.compare(this.heap[right], this.heap[smallest]) < 0) {
        smallest = right;
      }

      if (smallest !== index) {
        [this.heap[index], this.heap[smallest]] = [this.heap[smallest], this.heap[index]];
        index = smallest;
      } else {
        break;
      }
    }
  }
}

/**
 * Parking Manager Service
 */
export const ParkingManager = {
  /**
   * Validates license plate format.
   * Accepts standard alphanumeric formats e.g. "ABC-1234", "NY-8839", "7XYZ890".
   * Returns: { valid: boolean, message: string }
   */
  validatePlate(plate) {
    if (!plate || typeof plate !== 'string') {
      return { valid: false, message: 'License plate cannot be empty.' };
    }
    const clean = plate.trim().toUpperCase();
    if (clean.length < 2 || clean.length > 10) {
      return { valid: false, message: 'License plate must be 2 to 10 characters long.' };
    }
    const plateRegex = /^[A-Z0-9]{1,4}[- ]?[A-Z0-9]{1,5}$/;
    if (!plateRegex.test(clean)) {
      return { valid: false, message: 'Invalid plate format. Example: ABC-1234 or NY9820.' };
    }
    return { valid: true, cleanPlate: clean };
  },

  /**
   * O(1) Check: Checks if a vehicle with this plate is currently parked inside.
   */
  isPlateInside(plate) {
    const plateMap = Storage.getPlateMap();
    return plateMap.has(plate.trim().toUpperCase());
  },

  /**
   * Finds the nearest suitable free slot using the Min-Heap priority queue.
   *
   * ALGORITHM & TIME COMPLEXITY:
   * 1. Filters suitable candidate slots from N total slots: O(N)
   * 2. Inserts each candidate into the MinHeap: K * O(log K) <= O(N log N)
   * 3. Extracts the minimum distance slot: O(log K)
   * Total Time Complexity: O(N log N) worst-case, where N is total slots (60).
   *
   * @param {string} vehicleType 'bike' | 'car' | 'suv' | 'ev'
   * @param {boolean} requiresAccessible
   * @returns {Object|null} Nearest suitable slot or null
   */
  findNearestSlot(vehicleType, requiresAccessible = false) {
    const slots = Storage.getSlots();
    const minHeap = new MinHeap((a, b) => a.distance - b.distance);

    slots.forEach((slot) => {
      // Must be free
      if (slot.status !== 'free') return;

      // Accessibility requirement
      if (requiresAccessible && !slot.isAccessible) return;

      // Slot compatibility match
      let isCompatible = false;
      if (vehicleType === 'bike') {
        isCompatible = slot.type === 'bike' || slot.type === 'car';
      } else if (vehicleType === 'car') {
        isCompatible = slot.type === 'car' || slot.type === 'suv';
      } else if (vehicleType === 'suv') {
        isCompatible = slot.type === 'suv' || slot.type === 'car';
      } else if (vehicleType === 'ev') {
        // EVs can use EV charging slots (preferred) or regular car slots
        isCompatible = slot.isEv || slot.type === 'car';
      }

      if (isCompatible) {
        // Give slight priority score penalty if EV uses non-EV slot, or car uses bike slot
        let effectiveDistance = slot.distance;
        if (vehicleType === 'ev' && !slot.isEv) effectiveDistance += 10;
        if (vehicleType === 'car' && slot.type === 'suv') effectiveDistance += 2;

        minHeap.insert({
          ...slot,
          effectiveDistance,
        });
      }
    });

    if (minHeap.isEmpty()) {
      return null;
    }

    return minHeap.extractMin();
  },

  /**
   * Assigns a vehicle to a slot and creates an active ticket.
   * Returns created ticket object.
   */
  assignSlot(slotId, plate, vehicleType) {
    const cleanPlate = plate.trim().toUpperCase();
    const slot = Storage.getSlots().find((s) => s.id === slotId);
    if (!slot) throw new Error(`Slot ${slotId} not found.`);
    if (slot.status !== 'free' && slot.status !== 'reserved') {
      throw new Error(`Slot ${slotId} is currently ${slot.status.replace('_', ' ')}.`);
    }

    const now = Date.now();
    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    const ticketId = `TCK-${slot.id}-${randomSuffix}`;
    const newStatus = vehicleType === 'ev' && slot.isEv ? 'ev_charging' : 'occupied';

    const vehicleData = {
      plate: cleanPlate,
      type: vehicleType,
      ticketId,
      entryTime: now,
      slotId: slot.id,
    };

    // Update slot
    Storage.updateSlot(slot.id, {
      status: newStatus,
      currentVehicle: vehicleData,
    });

    // Create ticket
    const ticket = {
      ticketId,
      slotId: slot.id,
      floor: slot.floor,
      plate: cleanPlate,
      type: vehicleType,
      entryTime: now,
      status: 'active',
      isOverstay: false,
    };
    Storage.addTicket(ticket);

    // Add alert notification
    Storage.addNotification({
      type: 'info',
      title: 'Vehicle Checked In',
      message: `${vehicleType.toUpperCase()} ${cleanPlate} assigned to Slot ${slot.id} (Level ${slot.floor}).`,
    });

    return ticket;
  },

  /**
   * Releases an occupied slot and marks vehicle entry as complete.
   */
  releaseSlot(slotId) {
    const slot = Storage.getSlots().find((s) => s.id === slotId);
    if (!slot) return null;

    Storage.updateSlot(slotId, {
      status: 'free',
      currentVehicle: null,
    });

    return slot;
  },

  /**
   * Interval Overlap Detection Algorithm
   * Detects whether a proposed reservation [newStart, newEnd] conflicts with
   * existing reservations or current parking sessions on the given slot.
   *
   * FORMULA:
   * Two intervals [A_start, A_end] and [B_start, B_end] overlap if and only if:
   *   Max(A_start, B_start) < Min(A_end, B_end)
   *
   * TIME COMPLEXITY:
   * O(R) where R is the number of reservations on that slot.
   * Space Complexity: O(1)
   */
  checkReservationCollision(slotId, newStart, newEnd) {
    const reservations = Storage.getReservations();
    const slotReservations = reservations.filter(
      (r) => r.slotId === slotId && r.status === 'confirmed'
    );

    for (const res of slotReservations) {
      const overlap = Math.max(newStart, res.startTime) < Math.min(newEnd, res.endTime);
      if (overlap) {
        return {
          conflict: true,
          conflictingReservation: res,
          reason: `Slot ${slotId} is already reserved by ${res.driverName} from ${new Date(
            res.startTime
          ).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} to ${new Date(
            res.endTime
          ).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
        };
      }
    }

    // Check if slot is currently physically occupied
    const slot = Storage.getSlots().find((s) => s.id === slotId);
    if (slot && (slot.status === 'occupied' || slot.status === 'ev_charging')) {
      const now = Date.now();
      // If the reservation starts in the immediate future (< 15 mins) and slot is occupied
      if (newStart <= now + 15 * 60 * 1000) {
        return {
          conflict: true,
          reason: `Slot ${slotId} is currently physically occupied by vehicle ${slot.currentVehicle?.plate}.`,
        };
      }
    }

    return { conflict: false };
  },

  /**
   * Evaluates all active reservations and automatically releases bookings
   * if the driver is > 15 minutes late (no-show rule).
   */
  checkReservationNoShows() {
    const reservations = Storage.getReservations();
    const settings = Storage.getSettings();
    const graceMs = (settings.reservationGraceMinutes || 15) * 60 * 1000;
    const now = Date.now();
    let updatedCount = 0;

    reservations.forEach((res) => {
      if (res.status === 'confirmed') {
        // If start time was more than graceMs ago, and slot is still reserved
        if (now > res.startTime + graceMs) {
          const slot = Storage.getSlots().find((s) => s.id === res.slotId);
          // If slot has not been checked into
          if (slot && slot.status === 'reserved') {
            res.status = 'no_show_released';
            Storage.updateSlot(slot.id, { status: 'free' });
            Storage.addNotification({
              type: 'warning',
              title: 'Reservation Auto-Released',
              message: `Reservation ${res.id} for ${res.plate} auto-released due to 15-minute no-show.`,
            });
            updatedCount++;
          }
        }
      }
    });

    if (updatedCount > 0) {
      Storage.saveReservations(reservations);
    }
  },

  /**
   * Draws an authentic QR-style 2D matrix on a HTML5 Canvas element.
   * Renders standard QR corner position markers, timing strips, and
   * pseudo-randomized data modules deterministically seeded by ticket ID.
   */
  drawTicketQR(canvas, ticketId, size = 160) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    canvas.width = size;
    canvas.height = size;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);

    // Number of modules per side
    const modules = 21;
    const cellSize = size / modules;

    // Helper: Simple deterministic hash function for the ticket string
    let hash = 0;
    for (let i = 0; i < ticketId.length; i++) {
      hash = (hash << 5) - hash + ticketId.charCodeAt(i);
      hash |= 0;
    }

    // PRNG based on hash
    let seed = Math.abs(hash);
    function nextBit() {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280 > 0.5;
    }

    ctx.fillStyle = '#0f172a';

    // Helper to draw a square module
    function drawCell(r, c) {
      ctx.fillRect(c * cellSize, r * cellSize, cellSize + 0.5, cellSize + 0.5);
    }

    // 1. Draw 3 Finder Patterns at corners (7x7 modules each)
    function drawFinder(startR, startC) {
      for (let r = 0; r < 7; r++) {
        for (let c = 0; c < 7; c++) {
          if (
            r === 0 ||
            r === 6 ||
            c === 0 ||
            c === 6 ||
            (r >= 2 && r <= 4 && c >= 2 && c <= 4)
          ) {
            drawCell(startR + r, startC + c);
          }
        }
      }
    }

    drawFinder(0, 0); // Top-left
    drawFinder(0, modules - 7); // Top-right
    drawFinder(modules - 7, 0); // Bottom-left

    // 2. Timing patterns (alternating dots along row 6 and col 6)
    for (let i = 8; i < modules - 8; i++) {
      if (i % 2 === 0) {
        drawCell(6, i);
        drawCell(i, 6);
      }
    }

    // 3. Fill remaining data cells with deterministic bits
    for (let r = 0; r < modules; r++) {
      for (let c = 0; c < modules; c++) {
        // Skip finder zones
        const isTLFinder = r < 8 && c < 8;
        const isTRFinder = r < 8 && c >= modules - 8;
        const isBLFinder = r >= modules - 8 && c < 8;
        const isTiming = r === 6 || c === 6;

        if (!isTLFinder && !isTRFinder && !isBLFinder && !isTiming) {
          if (nextBit()) {
            drawCell(r, c);
          }
        }
      }
    }
  },
};
