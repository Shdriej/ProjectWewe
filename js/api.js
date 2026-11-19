"use strict";

const api = (() => {
  const CFG = { openHour: 9, closeHour: 23, currency: "₱", maxBookingHours: 8, maxDaysAhead: 90 };
  let supabaseClient;

  function client() {
    if (supabaseClient) return supabaseClient;
    const config = window.STUDIZZ1_SUPABASE;
    if (!window.supabase || typeof window.supabase.createClient !== "function") {
      throw new Error("Supabase could not load. Check your internet connection and reload.");
    }
    if (!config || !config.url || !config.publishableKey
      || config.url.includes("PASTE_") || config.publishableKey.includes("PASTE_")) {
      throw new Error("Add your Supabase project URL and publishable key in js/supabase-config.js.");
    }
    supabaseClient = window.supabase.createClient(config.url, config.publishableKey);
    return supabaseClient;
  }

  function unwrap({ data, error }) {
    if (error) {
      const e = new Error(error.message || "Supabase request failed.");
      e.status = error.status || (error.code === "23505" ? 409 : 500);
      e.code = error.code;
      throw e;
    }
    return data;
  }

  function requiredText(value, label) {
    if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required.`);
    return value.trim();
  }

  function toProfile(profile) {
    return {
      id: profile.id,
      name: profile.full_name,
      email: profile.email,
      role: profile.role,
      createdAt: profile.created_at,
    };
  }

  async function profileFor(user) {
    const profile = unwrap(await client()
      .from("profiles")
      .select("id,email,full_name,role,created_at")
      .eq("id", user.id)
      .maybeSingle());
    if (!profile) throw new Error("Your account profile is missing. Contact the studio manager.");
    return toProfile(profile);
  }

  async function currentProfile() {
    const { data: sessionData, error: sessionError } = await client().auth.getSession();
    if (sessionError) throw sessionError;
    if (!sessionData.session) return null;

    const { data, error } = await client().auth.getUser();
    if (error) throw error;
    return data.user ? profileFor(data.user) : null;
  }

  const STUDIO_SELECT = "id,name,city,address,blurb,tags,owner_id,version,rooms(id,studio_id,name,description,hourly_rate,is_active,created_at)";

  function toStudio(studio) {
    const rooms = (studio.rooms || [])
      .filter(room => room.is_active)
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map(room => ({
        id: room.id,
        studioId: room.studio_id,
        name: room.name,
        desc: room.description,
        rate: Number(room.hourly_rate),
      }));
    return {
      id: studio.id,
      name: studio.name,
      city: studio.city,
      address: studio.address,
      blurb: studio.blurb,
      tags: studio.tags || [],
      ownerId: studio.owner_id,
      version: studio.version,
      rooms,
      cheapest: rooms.length ? Math.min(...rooms.map(room => room.rate)) : null,
    };
  }

  function toGig(gig, studioName = "Studizz1") {
    return {
      id: gig.id,
      title: gig.title,
      act: gig.act,
      genre: gig.genre,
      price: Number(gig.price),
      city: gig.studio?.city || "Davao City",
      venue: gig.studio?.name || studioName,
      studioId: gig.studio_id,
      roomId: gig.room_id,
      date: gig.event_date,
      start: gig.start_hour,
      end: gig.end_hour,
    };
  }

  function toBooking(booking) {
    const studio = booking.studio || {};
    const room = booking.room || {};
    const customer = booking.customer || {};
    return {
      id: booking.id,
      studioId: booking.studio_id,
      roomId: booking.room_id,
      studioName: studio.name || "Studizz1",
      roomName: room.name || "Room",
      city: studio.city,
      address: studio.address,
      customerName: customer.full_name,
      customerEmail: customer.email,
      date: booking.booking_date,
      start: booking.start_hour,
      end: booking.end_hour,
      hours: booking.end_hour - booking.start_hour,
      total: Number(booking.total),
      notes: booking.notes,
      status: booking.status,
      createdAt: booking.created_at,
    };
  }

  async function featuredStudio() {
    return unwrap(await client()
      .from("studios")
      .select(STUDIO_SELECT)
      .eq("singleton", true)
      .single());
  }

  async function requireRole(...roles) {
    const user = await currentProfile();
    if (!user) {
      const e = new Error("Log in to continue.");
      e.status = 401;
      throw e;
    }
    if (!roles.includes(user.role)) {
      const e = new Error("You don't have permission to do that.");
      e.status = 403;
      throw e;
    }
    return user;
  }

  function toISO(date) {
    const pad = number => String(number).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  const BOOKING_SELECT = [
    "id,studio_id,room_id,user_id,booking_date,start_hour,end_hour,hourly_rate,total,notes,status,created_at",
    "studio:studios!bookings_studio_id_fkey(name,city,address)",
    "room:rooms!bookings_room_studio_fkey(name)",
    "customer:profiles!bookings_user_id_fkey(full_name,email)",
  ].join(",");

  return {
    config: async () => ({ ...CFG }),

    me: async () => ({ user: await currentProfile() }),

    login: async (email, password) => {
      if (typeof email !== "string" || typeof password !== "string") throw new Error("Enter your email and password.");
      const { data, error } = await client().auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });
      if (error) throw error;
      return { user: await profileFor(data.user) };
    },

    register: async (name, email, password) => {
      const fullName = requiredText(name, "Name");
      const cleanEmail = requiredText(email, "Email").toLowerCase();
      if (typeof password !== "string" || password.length < 8 || password.length > 72
        || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
        throw new Error("Password must be 8–72 characters and include a letter and a number.");
      }
      const { data, error } = await client().auth.signUp({
        email: cleanEmail,
        password,
        options: {
          data: { full_name: fullName },
          emailRedirectTo: `${location.origin}/index.html`,
        },
      });
      if (error) throw error;
      if (!data.session) return { user: null, needsEmailConfirmation: true };
      return { user: await profileFor(data.user), needsEmailConfirmation: false };
    },

    logout: async () => unwrap(await client().auth.signOut()) || { ok: true },

    studios: async () => {
      const studio = unwrap(await client()
        .from("studios")
        .select(STUDIO_SELECT)
        .eq("singleton", true)
        .maybeSingle());
      return studio ? [toStudio(studio)] : [];
    },

    studio: async id => {
      const studio = unwrap(await client()
        .from("studios")
        .select(STUDIO_SELECT)
        .eq("id", id)
        .eq("singleton", true)
        .maybeSingle());
      if (!studio) {
        const e = new Error("Studio not found.");
        e.status = 404;
        throw e;
      }
      return toStudio(studio);
    },

    schedule: async (studioId, date) => {
      const rows = unwrap(await client().rpc("get_room_schedule", {
        p_studio_id: studioId,
        p_date: date,
      })) || [];
      const studio = await api.studio(studioId);
      return {
        date,
        bookings: rows.filter(row => row.kind === "booking").map(row => ({
          id: row.id,
          roomId: row.room_id,
          start: row.start_hour,
          end: row.end_hour,
          label: row.title,
          mine: row.mine,
          canCancel: row.can_cancel,
        })),
        gigs: rows.filter(row => row.kind === "gig").map(row => ({
          id: row.id,
          roomId: row.room_id,
          title: row.title,
          label: row.title,
          act: row.act,
          genre: row.genre,
          price: Number(row.price),
          studioId,
          venue: studio.name,
          city: studio.city,
          date,
          start: row.start_hour,
          end: row.end_hour,
          gig: true,
        })),
      };
    },

    managedStudios: async () => {
      await requireRole("owner", "admin");
      const studio = unwrap(await client()
        .from("studios")
        .select(STUDIO_SELECT)
        .eq("singleton", true)
        .maybeSingle());
      return studio ? [toStudio(studio)] : [];
    },

    createStudio: async () => {
      throw new Error("This site is configured for one studio. Edit the existing studio profile instead.");
    },

    updateStudio: async (id, body) => {
      await requireRole("owner", "admin");
      const data = unwrap(await client()
        .from("studios")
        .update({
          name: requiredText(body.name, "Name"),
          city: requiredText(body.city, "City"),
          address: requiredText(body.address, "Address"),
          blurb: body.blurb || "",
          tags: Array.isArray(body.tags) ? body.tags : String(body.tags || "").split(",").map(tag => tag.trim()).filter(Boolean),
          version: body.version + 1,
        })
        .eq("id", id)
        .eq("version", body.version)
        .select(STUDIO_SELECT)
        .maybeSingle());
      if (!data) {
        const e = new Error("Someone else changed the studio profile. Reload and try again.");
        e.status = 409;
        throw e;
      }
      return { studio: toStudio(data) };
    },

    deleteStudio: async () => {
      throw new Error("The featured studio cannot be deleted.");
    },

    createRoom: async (studioId, body) => {
      await requireRole("owner", "admin");
      const room = unwrap(await client()
        .from("rooms")
        .insert({
          studio_id: studioId,
          name: requiredText(body.name, "Room name"),
          description: body.desc || "",
          hourly_rate: Number(body.rate),
        })
        .select("id,studio_id,name,description,hourly_rate")
        .single());
      return { room: { id: room.id, studioId: room.studio_id, name: room.name, desc: room.description, rate: Number(room.hourly_rate) } };
    },

    updateRoom: async (id, body) => {
      await requireRole("owner", "admin");
      const room = unwrap(await client()
        .from("rooms")
        .update({
          name: requiredText(body.name, "Room name"),
          description: body.desc || "",
          hourly_rate: Number(body.rate),
        })
        .eq("id", id)
        .select("id,studio_id,name,description,hourly_rate")
        .single());
      return { room: { id: room.id, studioId: room.studio_id, name: room.name, desc: room.description, rate: Number(room.hourly_rate) } };
    },

    deleteRoom: async id => {
      await requireRole("owner", "admin");
      unwrap(await client().rpc("deactivate_room", { p_room_id: id }));
      return { ok: true };
    },

    book: async payload => {
      const { data, error } = await client().rpc("create_booking", {
        p_room_id: payload.roomId,
        p_date: payload.date,
        p_start_hour: payload.start,
        p_end_hour: payload.end,
        p_notes: payload.notes || "",
      });
      if (error) {
        const e = new Error(error.message);
        e.status = /already taken|overlap/i.test(error.message) ? 409 : error.status || 400;
        throw e;
      }
      return { booking: toBooking(Array.isArray(data) ? data[0] : data) };
    },

    cancel: async id => {
      unwrap(await client().rpc("cancel_booking", { p_booking_id: id }));
      return { ok: true };
    },

    myBookings: async () => {
      const rows = unwrap(await client()
        .from("bookings")
        .select(BOOKING_SELECT)
        .order("booking_date", { ascending: false })
        .order("start_hour", { ascending: false })
        .limit(200));
      return rows.map(toBooking);
    },

    studioBookings: async params => {
      await requireRole("owner", "admin");
      const page = Math.max(1, Number(params && params.page) || 1);
      const limit = Math.min(100, Math.max(1, Number(params && params.limit) || 15));
      const from = (page - 1) * limit;
      let query = client()
        .from("bookings")
        .select(BOOKING_SELECT, { count: "exact" })
        .order("booking_date", { ascending: false })
        .order("start_hour", { ascending: false })
        .range(from, from + limit - 1);
      if (params && params.status) query = query.eq("status", params.status);
      if (params && params.date) query = query.eq("booking_date", params.date);
      const { data, error, count } = await query;
      if (error) unwrap({ error });
      return { bookings: data.map(toBooking), total: count || 0, page, limit };
    },

    gigs: async limit => {
      const { data, error } = await client()
        .from("gigs")
        .select("id,studio_id,room_id,title,act,genre,price,event_date,start_hour,end_hour,studio:studios!gigs_studio_id_fkey(name,city)")
        .gte("event_date", toISO(new Date()))
        .order("event_date", { ascending: true })
        .order("start_hour", { ascending: true })
        .limit(Number(limit) || 200);
      if (error) unwrap({ error });
      return data.map(gig => toGig(gig));
    },

    manageGigs: async () => {
      await requireRole("owner", "admin");
      const { data, error } = await client()
        .from("gigs")
        .select("id,studio_id,room_id,title,act,genre,price,event_date,start_hour,end_hour,studio:studios!gigs_studio_id_fkey(name,city)")
        .order("event_date", { ascending: false })
        .order("start_hour", { ascending: false })
        .limit(100);
      if (error) unwrap({ error });
      return data.map(gig => toGig(gig));
    },

    createGig: async body => {
      await requireRole("owner", "admin");
      const { data, error } = await client().rpc("create_gig", {
        p_room_id: body.roomId,
        p_title: requiredText(body.title, "Title"),
        p_act: requiredText(body.act, "Act"),
        p_genre: requiredText(body.genre, "Genre"),
        p_price: Number(body.price),
        p_date: body.date,
        p_start_hour: body.start,
        p_end_hour: body.end,
      });
      if (error) {
        const e = new Error(error.message);
        e.status = /already taken|overlap/i.test(error.message) ? 409 : error.status || 400;
        throw e;
      }
      return { gig: toGig(Array.isArray(data) ? data[0] : data) };
    },

    deleteGig: async id => {
      await requireRole("owner", "admin");
      const { data, error } = await client().from("gigs").delete().eq("id", id).select("id").maybeSingle();
      if (error) unwrap({ error });
      if (!data) {
        const e = new Error("Event not found or you do not have permission to delete it.");
        e.status = 404;
        throw e;
      }
      return { ok: true };
    },

    users: async params => {
      await requireRole("admin");
      const page = Math.max(1, Number(params && params.page) || 1);
      const limit = Math.min(100, Math.max(1, Number(params && params.limit) || 15));
      const from = (page - 1) * limit;
      const { data, error, count } = await client()
        .from("profiles")
        .select("id,email,full_name,role,created_at", { count: "exact" })
        .order("role")
        .order("full_name")
        .range(from, from + limit - 1);
      if (error) unwrap({ error });
      return { users: data.map(toProfile), total: count || 0, page, limit };
    },

    setRole: async (id, role) => {
      await requireRole("admin");
      unwrap(await client().rpc("admin_set_profile_role", { p_user_id: id, p_role: role }));
      return { ok: true };
    },

    deleteUser: async () => {
      throw new Error("Delete accounts from Supabase Authentication so the auth record and profile stay in sync.");
    },
  };
})();
