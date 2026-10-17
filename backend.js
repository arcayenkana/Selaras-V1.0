/* Penghubung ke Supabase lewat fetch biasa (tanpa library).
   Menyediakan antarmuka kecil (user, db, downloads) untuk peringkat/rekap, dan SELARAS_RT.rpc untuk kuis bareng.
   Bila supabaseUrl atau supabaseKey kosong, file ini tidak melakukan apa pun dan aplikasi berjalan lokal. */
(function () {
  "use strict";
  var C = window.SELARAS_CONFIG || {};
  var BASE = (C.supabaseUrl || "").trim().replace(/\/+$/, "");
  var KEY = (C.supabaseKey || "").trim();
  if (window.claude || !BASE || !KEY) return;

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }

  function randId() {
    var a = new Uint8Array(16), s = "";
    try { crypto.getRandomValues(a); } catch (e) { for (var i = 0; i < 16; i++) a[i] = Math.floor(Math.random() * 256); }
    for (var j = 0; j < a.length; j++) s += ("0" + a[j].toString(16)).slice(-2);
    return "u" + s;
  }
  function secretUid() {
    var u = lsGet("selaras.uid");
    if (!u || u.length < 12) { u = randId(); lsSet("selaras.uid", u); }
    return u;
  }
  // id publik = SHA-256(id rahasia) dipotong 24 karakter; sama dengan perhitungan di database.
  function pubId(uid) {
    try {
      if (window.crypto && crypto.subtle) {
        return crypto.subtle.digest("SHA-256", new TextEncoder().encode(uid)).then(function (buf) {
          var h = "", a = new Uint8Array(buf);
          for (var i = 0; i < a.length; i++) h += ("0" + a[i].toString(16)).slice(-2);
          return h.slice(0, 24);
        });
      }
    } catch (e) {}
    return Promise.resolve(uid.slice(0, 24));
  }

  // Kunci admin lewat tautan: https://situsmu/#admin=KUNCI
  var m = /^#admin=(.+)$/.exec(location.hash || "");
  if (m) {
    lsSet("selaras.admin", decodeURIComponent(m[1]));
    try { history.replaceState(null, "", location.pathname + location.search); } catch (e) {}
  }

  function rpc(fn, args) {
    var headers = { "apikey": KEY, "Content-Type": "application/json" };
    if (KEY.indexOf("eyJ") === 0) headers["Authorization"] = "Bearer " + KEY; // kunci anon lama berupa JWT
    return fetch(BASE + "/rest/v1/rpc/" + fn, { method: "POST", headers: headers, body: JSON.stringify(args || {}) })
      .then(function (r) {
        return r.text().then(function (t) {
          var j = null;
          try { j = t ? JSON.parse(t) : null; } catch (e) {}
          if (!r.ok) {
            var err = new Error((j && (j.message || j.hint)) || ("Gagal terhubung (" + r.status + ")"));
            err.code = r.status >= 400 && r.status < 500 ? "invalid_argument" : "network";
            err.status = r.status;
            throw err;
          }
          return j;
        });
      });
  }
  window.SELARAS_RT = { rpc: rpc, ready: true };

  var listeners = [], timer = null, busy = false;
  function pollOnce() {
    if (busy) return Promise.resolve();
    busy = true;
    var key = lsGet("selaras.admin");
    var p = key ? rpc("sel_rekap", { p_key: key }).catch(function () { lsDel("selaras.admin"); return rpc("sel_board"); }) : rpc("sel_board");
    return p.then(function (rows) {
      rows = rows || [];
      var snap = { docs: rows.map(function (r) { return { id: r.id, data: function () { return r.data; } }; }) };
      listeners.forEach(function (l) { try { l.ok(snap); } catch (e) {} });
    }).catch(function () {
      listeners.forEach(function (l) { if (l.err) try { l.err(); } catch (e) {} });
    }).then(function () { busy = false; });
  }
  function startPoll() {
    if (timer) return;
    pollOnce();
    timer = setInterval(function () { if (!document.hidden) pollOnce(); }, Math.max(8000, C.pollMs || 20000));
    document.addEventListener("visibilitychange", function () { if (!document.hidden) pollOnce(); });
  }

  var userCap = {
    id: function () { return pubId(secretUid()); },
    can: function () { return Promise.resolve(true); },
    canEdit: function () {
      var k = lsGet("selaras.admin");
      if (!k) return Promise.resolve(false);
      return rpc("sel_admin_check", { p_key: k }).then(function (ok) {
        if (!ok) lsDel("selaras.admin");
        return !!ok;
      }).catch(function () { return false; });
    }
  };
  var dbCap = {
    collection: function () {
      var q = {
        limit: function () { return q; },
        onSnapshot: function (ok, err) {
          var l = { ok: ok, err: err };
          listeners.push(l); startPoll();
          return function () { listeners = listeners.filter(function (x) { return x !== l; }); };
        }
      };
      return q;
    },
    doc: function () {
      return {
        set: function (data) { return rpc("sel_upsert", { p_uid: secretUid(), p_data: data }).then(function () { pollOnce(); }); },
        delete: function () { return rpc("sel_delete", { p_uid: secretUid() }).then(function () { pollOnce(); }); }
      };
    }
  };
  var dlCap = {
    save: function (o) {
      return new Promise(function (res, rej) {
        try {
          var blob = new Blob([o.data], { type: "text/csv;charset=utf-8" });
          var a = document.createElement("a");
          a.href = URL.createObjectURL(blob); a.download = o.filename || "data.csv";
          document.body.appendChild(a); a.click();
          setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
          res();
        } catch (e) { rej(e); }
      });
    }
  };
  window.claude = {
    use: function (name) {
      if (name === "user") return Promise.resolve(userCap);
      if (name === "db") return Promise.resolve(dbCap);
      if (name === "downloads") return Promise.resolve(dlCap);
      return Promise.reject(new Error("unsupported"));
    }
  };
})();
