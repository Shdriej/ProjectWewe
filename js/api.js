"use strict";

/*
 *
 */
const api = (() => {
  const DB_KEY = "studizzz-db-v1";
  const SESSION_KEY = "studizzz-session-v1";
  const CFG = { openHour: 9, closeHour: 23, currency: "₱", maxBookingHours: 8, maxDaysAhead: 90 };
  const FEATURED_STUDIO = {
    name: "Studizz1",
    city: "Davao City",
    address: "18 Acacia Lane, Calinan",
    blurb: "A welcoming, thoughtfully equipped space for rehearsals, recording, and good ideas.",
    tags: ["Sound-treated rooms", "Backline included", "Air-conditioned"],
  };
  const DEMO_PASSWORD = "Password123!";
  const ROLES = ["customer", "owner", "admin"];

 
  const fail = (status, message) => { const e = new Error(message); e.status = status; return e; };
  const pad = n => String(n).padStart(2, "0");
  const toISO = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const addDays = (iso, n) => { const [y, m, d] = iso.split("-").map(Number); return toISO(new Date(y, m - 1, d + n)); };
  const today = () => toISO(new Date());
  const nowHour = () => new Date().getHours();
  const hasStarted = (date, hour) => date < today() || (date === today() && hour <= nowHour());
  const range = (a, b) => Array.from({ length: Math.max(0, b - a) }, (_, i) => a + i);

  const ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  /* Alphanumeric primary keys: PREFIX + YYYYMMDD + 6 random characters, e.g. BKG20261116X7K2QP */
  function newId(prefix) {
    const bytes = new Uint8Array(6);
    globalThis.crypto.getRandomValues(bytes);
    return prefix + toISO(new Date()).replace(/-/g, "") + Array.from(bytes, b => ALPHA[b % ALPHA.length]).join("");
  }

  async function hashPassword(plain, salt) {
    const text = `${salt}:${plain}`;
    const c = globalThis.crypto;
    if (c && c.subtle) {
      const buf = await c.subtle.digest("SHA-256", new TextEncoder().encode(text));
      return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, "0")).join("");
    }
    let h = 2166136261; // fallback for browsers that block crypto.subtle (plain http)
    for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
    return "f" + (h >>> 0).toString(16);
  }

  /* ============ validation ============ */
  function str(v, label, { max = 200, optional = false } = {}) {
    if (v === undefined || v === null || v === "") { if (optional) return ""; throw fail(400, `${label} is required.`); }
    if (typeof v !== "string") throw fail(400, `${label} must be text.`);
    const s = v.trim();
    if (!s) { if (optional) return ""; throw fail(400, `${label} is required.`); }
    if (s.length > max) throw fail(400, `${label} must be ${max} characters or fewer.`);
    return s;
  }
  function int(v, label, min, max) {
    if (typeof v === "string" && /^-?\d+$/.test(v.trim())) v = Number(v);
    if (!Number.isInteger(v)) throw fail(400, `${label} must be a whole number.`);
    if (v < min || v > max) throw fail(400, `${label} must be between ${min} and ${max}.`);
    return v;
  }
  function num(v, label, min, max) {
    if (typeof v === "string" && v.trim() !== "") v = Number(v);
    if (typeof v !== "number" || !Number.isFinite(v)) throw fail(400, `${label} must be a number.`);
    if (v < min || v > max) throw fail(400, `${label} must be between ${min} and ${max}.`);
    return Math.round(v * 100) / 100;
  }
  function dateStr(v, label) {
    const s = str(v, label, { max: 10 });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw fail(400, `${label} must look like 2026-11-30.`);
    const [y, m, d] = s.split("-").map(Number);
    const real = new Date(y, m - 1, d);
    if (real.getFullYear() !== y || real.getMonth() !== m - 1 || real.getDate() !== d) throw fail(400, `${label} is not a real date.`);
    return s;
  }
  function tagList(v) {
    if (v === undefined || v === null || v === "") return [];
    const list = (typeof v === "string" ? v.split(",") : v).map(t => String(t).trim()).filter(Boolean);
    const out = [...new Set(list)];
    if (out.length > 10) throw fail(400, "Use 10 tags or fewer.");
    return out;
  }
  function emailStr(v) {
    const s = str(v, "Email", { max: 254 }).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) throw fail(400, "Enter a valid email address.");
    return s;
  }
  function passwordStr(v) {
    if (typeof v !== "string") throw fail(400, "Password is required.");
    if (v.length < 8) throw fail(400, "Password must be at least 8 characters.");
    if (v.length > 72) throw fail(400, "Password must be 72 characters or fewer.");
    if (!/[A-Za-z]/.test(v) || !/\d/.test(v)) throw fail(400, "Password needs at least one letter and one number.");
    return v;
  }

  /* ============ storage ============ */
  let memDb = null; // used when localStorage is blocked
  function load() {
    try {
      const raw = localStorage.getItem(DB_KEY);
      if (raw) return JSON.parse(raw);
    } catch { /* fall through to memory */ }
    return memDb;
  }
  function save(db) {
    memDb = db;
    try { localStorage.setItem(DB_KEY, JSON.stringify(db)); } catch { /* memory copy still works for this page view */ }
  }
  let memSession = null;
  const getSession = () => { try { return localStorage.getItem(SESSION_KEY); } catch { return memSession; } };
  const setSession = id => { memSession = id; try { id ? localStorage.setItem(SESSION_KEY, id) : localStorage.removeItem(SESSION_KEY); } catch {} };

  /* ============ demo data ============ */
  const BASE_STUDIOS = [
    { ...FEATURED_STUDIO, owner: 0,
      rooms: [["The Live Room", "Full-band rehearsal · up to 8 people", 550], ["The Writing Room", "Acoustic sets · up to 4 people", 350], ["The Booth", "Vocals, voice-over, and demos", 400]] },
  ];
  // studio = [studio index, room index]; `in` = days from today
  const BASE_GIGS = [
    { title: "Studizz1 Open Mic", act: "A friendly night for local voices", studio: [0, 0], in: 2, start: 19, end: 22, price: 150, genre: "Mixed" },
    { title: "Acoustic Room Sessions", act: "Mara Quinn and guests", studio: [0, 1], in: 6, start: 18, end: 21, price: 250, genre: "Acoustic" },
  ];
  // [customer index, studio index, room index, days from today, start, end, notes]
  const BASE_BOOKINGS = [
    [0, 0, 0, 1, 10, 12, "Full band rehearsal"],
    [1, 0, 1, 3, 14, 16, "Songwriting session"],
    [0, 0, 2, 4, 18, 20, "Vocal demo"],
    [1, 0, 0, -3, 16, 18, "Last week's rehearsal"],
  ];

  function migrateFeaturedStudio(db) {
    const savedStudio = db.studios.find(s => s.id === db.featuredStudioId);
    if (savedStudio) {
      if (savedStudio.name !== "Juniper Sound Studio") return false;
      savedStudio.name = FEATURED_STUDIO.name;
      savedStudio.version = (savedStudio.version || 0) + 1;
      db.gigs.forEach(gig => {
        if (gig.studioId === savedStudio.id) {
          gig.venue = FEATURED_STUDIO.name;
          if (gig.title === "Juniper Open Mic") gig.title = "Studizz1 Open Mic";
        }
      });
      return true;
    }
    const studio = db.studios.find(s => s.name === "Fitzroy Sessions") || db.studios[0];
    if (!studio) return false;

    db.featuredStudioId = studio.id;
    Object.assign(studio, FEATURED_STUDIO, { ownerId: db.users.find(u => u.email === "owner01@studizzz.test")?.id || studio.ownerId, version: (studio.version || 0) + 1 });
    const defaultRoomNames = ["Studio 1", "Studio 2", "Studio 3"];
    db.rooms.filter(r => r.studioId === studio.id).forEach((room, index) => {
      if (room.name === defaultRoomNames[index]) {
        const [name, desc, rate] = BASE_STUDIOS[0].rooms[index];
        Object.assign(room, { name, desc, rate });
      }
    });
    db.gigs.forEach(gig => {
      if (gig.studioId === studio.id) Object.assign(gig, { city: FEATURED_STUDIO.city, venue: FEATURED_STUDIO.name });
    });
    return true;
  }

  async function seed() {
    const now = new Date().toISOString();
    const users = [];
    const addUser = async (name, email, role) => {
      const salt = newId("SLT");
      const u = { id: newId("USR"), name, email, role, salt, passwordHash: await hashPassword(DEMO_PASSWORD, salt), createdAt: now };
      users.push(u);
      return u;
    };
    await addUser("Site Admin", "admin@studizzz.test", "admin");
    const owners = [await addUser("Studio Manager", "owner01@studizzz.test", "owner")];
    const customers = [await addUser("Ana Cruz", "customer001@studizzz.test", "customer"), await addUser("Ben Garcia", "customer002@studizzz.test", "customer")];

    const studios = [], rooms = [];
    BASE_STUDIOS.forEach(s => {
      const studio = { id: newId("STU"), name: s.name, city: s.city, address: s.address, blurb: s.blurb, tags: s.tags, ownerId: owners[s.owner].id, version: 0, createdAt: now };
      studios.push(studio);
      s.rooms.forEach(([name, desc, rate]) => rooms.push({ id: newId("ROM"), studioId: studio.id, name, desc, rate }));
    });
    const roomsOf = studioId => rooms.filter(r => r.studioId === studioId);
    const db = { users, studios, rooms, gigs: [], bookings: [], featuredStudioId: studios[0].id };

    BASE_GIGS.forEach(g => {
      const gig = { id: newId("GIG"), title: g.title, act: g.act, genre: g.genre, price: g.price, city: g.city, venue: g.venue, date: addDays(today(), g.in), start: g.start, end: g.end, createdBy: users[0].id };
      if (g.studio) {
        const studio = studios[g.studio[0]];
        gig.studioId = studio.id; gig.roomId = roomsOf(studio.id)[g.studio[1]].id; gig.createdBy = studio.ownerId;
      }
      db.gigs.push(gig);
    });

    BASE_BOOKINGS.forEach(([c, s, r, d, start, end, notes]) => {
      const studio = studios[s], room = roomsOf(studio.id)[r], date = addDays(today(), d);
      if (roomBusy(db, room.id, date, start, end)) return;
      db.bookings.push({
        id: newId("BKG"), userId: customers[c].id, studioId: studio.id, roomId: room.id, studioName: studio.name, roomName: room.name,
        date, start, end, hours: end - start, rate: room.rate, total: (end - start) * room.rate, notes, status: "confirmed", createdAt: now,
      });
    });
    save(db);
  }

  let seeding = null;
  async function ready() {
    const existing = load();
    if (existing) {
      if (migrateFeaturedStudio(existing)) save(existing);
      return;
    }
    if (!seeding) seeding = seed().finally(() => { seeding = null; });
    await seeding;
  }

  /* ============ shaping ============ */
  const publicUser = u => ({ id: u.id, name: u.name, email: u.email, role: u.role });
  const userDto = u => ({ id: u.id, name: u.name, email: u.email, role: u.role, createdAt: u.createdAt });
  const roomDto = r => ({ id: r.id, studioId: r.studioId, name: r.name, desc: r.desc, rate: r.rate });
  function studioDto(db, s) {
    const rooms = db.rooms.filter(r => r.studioId === s.id).sort((a, b) => (a.id < b.id ? -1 : 1));
    // keep the original room order (insertion order) rather than id order
    const ordered = db.rooms.filter(r => r.studioId === s.id);
    return {
      id: s.id, name: s.name, city: s.city, address: s.address, blurb: s.blurb, tags: s.tags || [], ownerId: s.ownerId, version: s.version || 0,
      rooms: ordered.map(roomDto), cheapest: rooms.length ? Math.min(...rooms.map(r => r.rate)) : null,
    };
  }
  const gigDto = g => ({
    id: g.id, title: g.title, act: g.act, genre: g.genre, price: g.price, city: g.city, venue: g.venue,
    studioId: g.studioId || null, roomId: g.roomId || null, date: g.date, start: g.start, end: g.end,
  });
  function bookingDto(db, b) {
    const studio = db.studios.find(s => s.id === b.studioId);
    const room = db.rooms.find(r => r.id === b.roomId);
    const customer = db.users.find(u => u.id === b.userId);
    return {
      id: b.id, studioId: b.studioId, roomId: b.roomId,
      studioName: (studio && studio.name) || b.studioName, roomName: (room && room.name) || b.roomName,
      city: studio ? studio.city : undefined, address: studio ? studio.address : undefined,
      customerName: customer ? customer.name : undefined, customerEmail: customer ? customer.email : undefined,
      date: b.date, start: b.start, end: b.end, hours: b.hours, total: b.total, notes: b.notes, status: b.status, createdAt: b.createdAt,
    };
  }

  /* ============ access ============ */
  const currentUser = db => {
    const id = getSession();
    const u = id && db.users.find(x => x.id === id);
    return u ? publicUser(u) : null;
  };
  function needUser(db) {
    const u = currentUser(db);
    if (!u) throw fail(401, "Log in to continue.");
    return u;
  }
  function needRole(db, ...roles) {
    const u = needUser(db);
    if (!roles.includes(u.role)) throw fail(403, "You don't have permission to do that.");
    return u;
  }
  function managedStudio(db, user, studioId) {
    const studio = db.studios.find(s => s.id === studioId);
    if (!studio) throw fail(404, "Studio not found.");
    if (user.role !== "admin" && studio.ownerId !== user.id) throw fail(403, "You don't manage this studio.");
    return studio;
  }
  const managedIds = (db, user) => (user.role === "admin" ? null : db.studios.filter(s => s.ownerId === user.id).map(s => s.id));

  /* A room is busy if a confirmed booking or a gig overlaps the hours [start, end) */
  function roomBusy(db, roomId, date, start, end) {
    const overlaps = x => x.roomId === roomId && x.date === date && start < x.end && x.start < end;
    return db.bookings.some(b => b.status === "confirmed" && overlaps(b)) || db.gigs.some(overlaps);
  }

  const paginate = (list, params) => {
    const page = params && params.page ? int(params.page, "Page", 1, 100000) : 1;
    const limit = params && params.limit ? int(params.limit, "Limit", 1, 100) : 25;
    return { page, limit, total: list.length, slice: list.slice((page - 1) * limit, page * limit) };
  };

  /* Runs a function against the freshly loaded database after the demo data exists */
  const op = fn => async (...args) => { await ready(); return fn(load(), ...args); };

  /* ============ public API (same names as the server version) ============ */
  return {
    config: op(() => ({ ...CFG })),
    me: op(db => ({ user: currentUser(db) })),

    login: async (email, password) => {
      await ready();
      if (typeof email !== "string" || typeof password !== "string") throw fail(400, "Enter your email and password.");
      const db = load();
      const user = db.users.find(u => u.email === email.trim().toLowerCase());
      const hash = await hashPassword(password.slice(0, 200), user ? user.salt : "none");
      if (!user || hash !== user.passwordHash) throw fail(401, "Incorrect email or password.");
      setSession(user.id);
      return { user: publicUser(user) };
    },
    register: async (name, email, password) => {
      await ready();
      const cleanName = str(name, "Name", { max: 80 });
      const cleanEmail = emailStr(email);
      const cleanPassword = passwordStr(password);
      const salt = newId("SLT");
      const passwordHash = await hashPassword(cleanPassword, salt);
      const db = load(); // read again after the await so nothing saved in between is lost
      if (db.users.some(u => u.email === cleanEmail)) throw fail(409, "An account with that email already exists.");
      const user = { id: newId("USR"), name: cleanName, email: cleanEmail, role: "customer", salt, passwordHash, createdAt: new Date().toISOString() };
      db.users.push(user);
      save(db);
      setSession(user.id);
      return { user: publicUser(user) };
    },
    logout: op(() => { setSession(null); return { ok: true }; }),

    /* ----- studios and rooms ----- */
    studios: op(db => {
      const list = db.studios.filter(s => s.id === db.featuredStudioId);
      const t = today(), h = nowHour();
      const hoursLeft = range(CFG.openHour, CFG.closeHour).filter(x => x > h).length;
      return list.map(s => {
        const rooms = db.rooms.filter(r => r.studioId === s.id);
        const ids = new Set(rooms.map(r => r.id));
        let taken = 0;
        db.bookings.forEach(b => { if (b.status === "confirmed" && ids.has(b.roomId) && b.date === t) taken += range(b.start, b.end).filter(x => x > h).length; });
        db.gigs.forEach(g => { if (ids.has(g.roomId) && g.date === t) taken += range(g.start, g.end).filter(x => x > h).length; });
        return { ...studioDto(db, s), openRoomHours: Math.max(0, rooms.length * hoursLeft - taken) };
      });
    }),
    studio: op((db, id) => {
      const s = db.studios.find(x => x.id === id && x.id === db.featuredStudioId);
      if (!s) throw fail(404, "Studio not found.");
      return studioDto(db, s);
    }),
    schedule: op((db, id, date) => {
      const studio = db.studios.find(s => s.id === id && s.id === db.featuredStudioId);
      if (!studio) throw fail(404, "Studio not found.");
      date = dateStr(date, "Date");
      const user = currentUser(db);
      const manages = !!user && (user.role === "admin" || studio.ownerId === user.id);
      const bookings = db.bookings.filter(b => b.studioId === id && b.date === date && b.status === "confirmed");
      return {
        date,
        bookings: bookings.map(b => {
          const mine = !!user && b.userId === user.id;
          const customer = db.users.find(u => u.id === b.userId);
          return {
            id: b.id, roomId: b.roomId, start: b.start, end: b.end, mine,
            label: mine ? "You" : manages ? (customer ? customer.name : "Customer") : "Booked",
            canCancel: (mine || manages) && !hasStarted(b.date, b.start),
          };
        }),
        gigs: db.gigs.filter(g => g.studioId === id && g.date === date).map(gigDto),
      };
    }),
    managedStudios: op(db => {
      const user = needRole(db, "owner", "admin");
      return db.studios.filter(s => s.id === db.featuredStudioId && (user.role === "admin" || s.ownerId === user.id)).map(s => studioDto(db, s));
    }),
    createStudio: op((db, body) => {
      const user = needRole(db, "owner", "admin");
      if (db.studios.some(s => s.id === db.featuredStudioId)) throw fail(409, "This site is set up for one studio.");
      body = body || {};
      let ownerId = user.id;
      if (user.role === "admin" && body.ownerId) {
        const owner = db.users.find(u => u.id === body.ownerId && u.role !== "customer");
        if (!owner) throw fail(400, "That owner doesn't exist.");
        ownerId = owner.id;
      }
      const studio = {
        id: newId("STU"), name: str(body.name, "Name", { max: 80 }), city: str(body.city, "City", { max: 60 }), address: str(body.address, "Address", { max: 120 }),
        blurb: str(body.blurb, "Description", { max: 300, optional: true }), tags: tagList(body.tags), ownerId, version: 0, createdAt: new Date().toISOString(),
      };
      db.studios.push(studio);
      save(db);
      return { studio: studioDto(db, studio) };
    }),
    /* Optimistic locking: the update only applies if the version the form loaded is still current */
    updateStudio: op((db, id, body) => {
      const user = needRole(db, "owner", "admin");
      body = body || {};
      const studio = managedStudio(db, user, id);
      const fields = {
        name: str(body.name, "Name", { max: 80 }), city: str(body.city, "City", { max: 60 }), address: str(body.address, "Address", { max: 120 }),
        blurb: str(body.blurb, "Description", { max: 300, optional: true }), tags: tagList(body.tags),
      };
      const version = int(body.version, "Version", 0, 1e9);
      if ((studio.version || 0) !== version) throw fail(409, "Someone else changed this studio. Reload and try again.");
      Object.assign(studio, fields, { version: version + 1 });
      db.gigs.forEach(g => { if (g.studioId === id) { g.venue = fields.name; g.city = fields.city; } });
      save(db);
      return { studio: studioDto(db, studio) };
    }),
    deleteStudio: op((db, id) => {
      const user = needRole(db, "owner", "admin");
      managedStudio(db, user, id);
      if (id === db.featuredStudioId) throw fail(409, "The featured studio can't be deleted.");
      const upcoming = db.bookings.filter(b => b.studioId === id && b.status === "confirmed" && b.date >= today()).length;
      if (upcoming) throw fail(409, `Cancel the ${upcoming} upcoming booking(s) first.`);
      db.gigs = db.gigs.filter(g => g.studioId !== id);
      db.rooms = db.rooms.filter(r => r.studioId !== id);
      db.studios = db.studios.filter(s => s.id !== id);
      save(db);
      return { ok: true };
    }),
    createRoom: op((db, studioId, body) => {
      const user = needRole(db, "owner", "admin");
      body = body || {};
      managedStudio(db, user, studioId);
      const room = { id: newId("ROM"), studioId, name: str(body.name, "Room name", { max: 60 }), desc: str(body.desc, "Description", { max: 100, optional: true }), rate: num(body.rate, "Hourly rate", 1, 100000) };
      db.rooms.push(room);
      save(db);
      return { room: roomDto(room) };
    }),
    updateRoom: op((db, id, body) => {
      const user = needRole(db, "owner", "admin");
      body = body || {};
      const room = db.rooms.find(r => r.id === id);
      if (!room) throw fail(404, "Room not found.");
      managedStudio(db, user, room.studioId);
      Object.assign(room, { name: str(body.name, "Room name", { max: 60 }), desc: str(body.desc, "Description", { max: 100, optional: true }), rate: num(body.rate, "Hourly rate", 1, 100000) });
      save(db);
      return { room: roomDto(room) };
    }),
    deleteRoom: op((db, id) => {
      const user = needRole(db, "owner", "admin");
      const room = db.rooms.find(r => r.id === id);
      if (!room) throw fail(404, "Room not found.");
      managedStudio(db, user, room.studioId);
      const busy = db.bookings.some(b => b.roomId === id && b.status === "confirmed" && b.date >= today()) || db.gigs.some(g => g.roomId === id && g.date >= today());
      if (busy) throw fail(409, "This room has upcoming bookings or gigs. Cancel them first.");
      db.rooms = db.rooms.filter(r => r.id !== id);
      save(db);
      return { ok: true };
    }),

    /* ----- bookings ----- */
    book: op((db, payload) => {
      const user = needUser(db);
      const b = payload || {};
      const studioId = str(b.studioId, "Studio"), roomId = str(b.roomId, "Room");
      const date = dateStr(b.date, "Date");
      const start = int(b.start, "Start hour", CFG.openHour, CFG.closeHour - 1);
      const end = int(b.end, "End hour", CFG.openHour + 1, CFG.closeHour);
      const notes = str(b.notes, "Notes", { max: 300, optional: true });
      if (end <= start) throw fail(400, "End time must be after the start time.");
      if (end - start > CFG.maxBookingHours) throw fail(400, `Bookings are limited to ${CFG.maxBookingHours} hours.`);
      if (date < today()) throw fail(400, "That date has already passed.");
      if (date === today() && start <= nowHour()) throw fail(400, "That time has already started.");
      if (date > addDays(today(), CFG.maxDaysAhead)) throw fail(400, `You can book up to ${CFG.maxDaysAhead} days ahead.`);

      const studio = db.studios.find(s => s.id === studioId);
      if (!studio) throw fail(404, "Studio not found.");
      const room = db.rooms.find(r => r.id === roomId && r.studioId === studioId);
      if (!room) throw fail(404, "Room not found.");
      // JavaScript runs one operation at a time and the data was read just now, so this check-then-save cannot interleave
      if (roomBusy(db, roomId, date, start, end)) throw fail(409, "Part of that time is already taken. Pick another range.");

      const booking = {
        id: newId("BKG"), userId: user.id, studioId, roomId, studioName: studio.name, roomName: room.name,
        date, start, end, hours: end - start, rate: room.rate, total: (end - start) * room.rate, notes, status: "confirmed", createdAt: new Date().toISOString(),
      };
      db.bookings.push(booking);
      save(db);
      return { booking: bookingDto(db, booking) };
    }),
    cancel: op((db, id) => {
      const user = needUser(db);
      const booking = db.bookings.find(b => b.id === id);
      if (!booking) throw fail(404, "Booking not found.");
      const studio = db.studios.find(s => s.id === booking.studioId);
      const manages = user.role === "admin" || (studio && studio.ownerId === user.id);
      if (booking.userId !== user.id && !manages) throw fail(403, "You can't cancel this booking.");
      if (booking.status !== "confirmed") throw fail(409, "That booking is already cancelled.");
      if (hasStarted(booking.date, booking.start)) throw fail(409, "Bookings that have already started can't be cancelled.");
      Object.assign(booking, { status: "cancelled", cancelledAt: new Date().toISOString(), cancelledBy: user.id });
      save(db);
      return { ok: true };
    }),
    myBookings: op(db => {
      const user = needUser(db);
      return db.bookings.filter(b => b.userId === user.id)
        .sort((a, b) => (a.date === b.date ? b.start - a.start : a.date < b.date ? 1 : -1)).slice(0, 200).map(b => bookingDto(db, b));
    }),
    studioBookings: op((db, params) => {
      const user = needRole(db, "owner", "admin");
      params = params || {};
      const owned = managedIds(db, user);
      let list = db.bookings.filter(b => b.studioId === db.featuredStudioId && (!owned || owned.includes(b.studioId)));
      if (params.status) list = list.filter(b => b.status === params.status);
      if (params.date) list = list.filter(b => b.date === params.date);
      list.sort((a, b) => (a.date === b.date ? b.start - a.start : a.date < b.date ? 1 : -1));
      const p = paginate(list, params);
      return { bookings: p.slice.map(b => bookingDto(db, b)), total: p.total, page: p.page, limit: p.limit };
    }),

    /* ----- gigs ----- */
    gigs: op((db, limit) => {
      const max = limit ? int(limit, "Limit", 1, 200) : 200;
      return db.gigs.filter(g => g.studioId === db.featuredStudioId && g.date >= today())
        .sort((a, b) => (a.date === b.date ? a.start - b.start : a.date < b.date ? -1 : 1)).slice(0, max).map(gigDto);
    }),
    manageGigs: op(db => {
      const user = needRole(db, "owner", "admin");
      const owned = managedIds(db, user);
      return db.gigs.filter(g => g.studioId === db.featuredStudioId && (!owned || g.createdBy === user.id || owned.includes(g.studioId)))
        .sort((a, b) => (a.date === b.date ? b.start - a.start : a.date < b.date ? 1 : -1)).slice(0, 100).map(gigDto);
    }),
    createGig: op((db, body) => {
      const user = needRole(db, "owner", "admin");
      const b = body || {};
      const gig = {
        id: newId("GIG"), title: str(b.title, "Title", { max: 100 }), act: str(b.act, "Act", { max: 150 }), genre: str(b.genre, "Genre", { max: 40 }),
        price: num(b.price, "Price", 0, 100000), date: dateStr(b.date, "Date"),
        start: int(b.start, "Start hour", CFG.openHour, CFG.closeHour - 1), end: int(b.end, "End hour", CFG.openHour + 1, CFG.closeHour),
        createdBy: user.id,
      };
      if (gig.end <= gig.start) throw fail(400, "End time must be after the start time.");
      if (gig.date < today()) throw fail(400, "That date has already passed.");
      if (b.studioId) {
        gig.studioId = str(b.studioId, "Studio");
        gig.roomId = str(b.roomId, "Room");
        const studio = managedStudio(db, user, gig.studioId);
        const room = db.rooms.find(r => r.id === gig.roomId && r.studioId === gig.studioId);
        if (!room) throw fail(404, "Room not found.");
        if (roomBusy(db, gig.roomId, gig.date, gig.start, gig.end)) throw fail(409, "Part of that time is already taken. Pick another range.");
        gig.venue = studio.name; gig.city = studio.city;
      } else {
        gig.venue = str(b.venue, "Venue", { max: 100 });
        gig.city = str(b.city, "City", { max: 60 });
      }
      db.gigs.push(gig);
      save(db);
      return { gig: gigDto(gig) };
    }),
    deleteGig: op((db, id) => {
      const user = needRole(db, "owner", "admin");
      const gig = db.gigs.find(g => g.id === id);
      if (!gig) throw fail(404, "Gig not found.");
      const studio = gig.studioId ? db.studios.find(s => s.id === gig.studioId) : null;
      if (!(user.role === "admin" || gig.createdBy === user.id || (studio && studio.ownerId === user.id))) throw fail(403, "You can't remove this gig.");
      db.gigs = db.gigs.filter(g => g.id !== id);
      save(db);
      return { ok: true };
    }),

    /* ----- users (admin) ----- */
    users: op((db, params) => {
      needRole(db, "admin");
      const order = { admin: 0, owner: 1, customer: 2 };
      const list = [...db.users].sort((a, b) => order[a.role] - order[b.role] || a.name.localeCompare(b.name));
      const p = paginate(list, params);
      return { users: p.slice.map(userDto), total: p.total, page: p.page, limit: p.limit };
    }),
    setRole: op((db, id, role) => {
      const user = needRole(db, "admin");
      if (!ROLES.includes(role)) throw fail(400, `Role must be one of: ${ROLES.join(", ")}.`);
      if (id === user.id) throw fail(400, "You can't change your own role.");
      const target = db.users.find(u => u.id === id);
      if (!target) throw fail(404, "User not found.");
      target.role = role;
      save(db);
      return { ok: true };
    }),
    /* Deleting a user cancels their upcoming bookings in the same save */
    deleteUser: op((db, id) => {
      const user = needRole(db, "admin");
      if (id === user.id) throw fail(400, "You can't delete your own account here.");
      const target = db.users.find(u => u.id === id);
      if (!target) throw fail(404, "User not found.");
      if (db.studios.some(s => s.ownerId === id)) throw fail(409, "This user owns studios. Reassign or delete them first.");
      db.bookings.forEach(b => {
        if (b.userId === id && b.status === "confirmed" && b.date >= today()) Object.assign(b, { status: "cancelled", cancelledAt: new Date().toISOString(), cancelledBy: user.id });
      });
      db.users = db.users.filter(u => u.id !== id);
      save(db);
      return { ok: true };
    }),

  };
})();
