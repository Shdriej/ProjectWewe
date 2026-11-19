# Studizz1

A single-studio rehearsal and recording site with room availability, account sign-in, bookings, events, and a studio manager dashboard. Supabase provides PostgreSQL storage and authentication.



   ```sql
   update public.profiles
   set role = 'owner'
   where email = lower('chidreyolaco@gmail.com');

   update public.studios
   set owner_id = (
     select id from public.profiles
     where email = lower('chidrwy@gmail.com')
   )
   where singleton = true;
   ```

   This grants that account access to the studio dashboard. Do not expose a Supabase secret or `service_role` key in the browser.

The schema seeds the studio, its three rooms, and two sample events. Browser-only demo accounts and bookings from the old version are not migrated.
