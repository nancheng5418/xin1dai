/* 本地数据服务：替代 api.php / weather.php / online.php / license_status.php / ip.php
   让整站无需 PHP 后端即可独立运行（南城版） */
(function () {
  'use strict';
  var D = window.__SITE_DATA__ || {};
  var S = D.snapshot || {};
  var SET = S.settings || {};
  var WEATHER_TEXT = {
    0: '晴', 1: '少云', 2: '多云', 3: '阴', 45: '雾', 48: '雾凇',
    51: '小毛毛雨', 53: '毛毛雨', 55: '大毛毛雨', 56: '冻毛毛雨', 57: '强冻毛毛雨',
    61: '小雨', 63: '中雨', 65: '大雨', 66: '冻雨', 67: '强冻雨',
    71: '小雪', 73: '中雪', 75: '大雪', 77: '雪粒',
    80: '阵雨', 81: '强阵雨', 82: '暴阵雨', 85: '阵雪', 86: '强阵雪',
    95: '雷阵雨', 96: '雷阵雨伴冰雹', 99: '强雷阵雨伴冰雹'
  };

  function nowSec() { return Math.floor(Date.now() / 1000); }
  function fmtMinute(d) {
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function jsonResponse(obj, status) {
    return new Response(JSON.stringify(obj), {
      status: status || 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
    });
  }
  function withTimeout(p, ms) {
    return new Promise(function (resolve, reject) {
      var t = setTimeout(function () { reject(new Error('timeout')); }, ms || 6000);
      p.then(function (v) { clearTimeout(t); resolve(v); }, function (e) { clearTimeout(t); reject(e); });
    });
  }
  function getJSON(url) {
    return withTimeout(fetch(url, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('http ' + r.status);
      return r.json();
    }), 7000);
  }

  /* ---------- 天气 ---------- */
  var CACHE_KEY = 'nc-weather-cache-v1';
  var WWO_TEXT = {
    113: '晴', 116: '多云', 119: '阴', 122: '阴', 143: '雾', 248: '雾', 260: '冻雾',
    176: '阵雨', 353: '小阵雨', 356: '阵雨', 359: '暴雨', 200: '雷阵雨', 386: '雷阵雨', 389: '强雷阵雨',
    179: '阵雪', 182: '雨夹雪', 185: '冻毛毛雨', 227: '吹雪', 230: '暴风雪', 320: '雨夹雪',
    263: '小毛毛雨', 266: '毛毛雨', 281: '冻毛毛雨', 284: '强冻毛毛雨',
    293: '小雨', 296: '小雨', 299: '中雨', 302: '中雨', 305: '大雨', 308: '大雨',
    311: '小冻雨', 314: '冻雨', 317: '小雨夹雪',
    323: '小雪', 326: '小雪', 329: '中雪', 332: '中雪', 335: '大雪', 338: '大雪',
    350: '冰粒', 362: '小阵雪', 365: '阵雪', 368: '小阵雪', 371: '大雪', 374: '冰粒', 377: '冰粒',
    392: '雷雪', 395: '雷暴雪'
  };

  function defaultCity() { return (SET.page_builder && SET.page_builder.weather_city) ? SET.page_builder.weather_city : '北京'; }
  function hasCJK(str) { return /[\u3400-\u9fff]/.test(String(str || '')); }

  function readCache() {
    try {
      var o = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
      if (!o) return null;
      if (Date.now() - (o.ts || 0) > 10 * 60 * 1000) return null;
      return o;
    } catch (e) { return null; }
  }
  function readCacheAny() {
    try { return JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'); } catch (e) { return null; }
  }
  function writeCache(o) {
    try { o.ts = Date.now(); localStorage.setItem(CACHE_KEY, JSON.stringify(o)); } catch (e) { }
  }
  function firstOk(tasks, ms) {
    return new Promise(function (resolve) {
      var done = false;
      function finish(v) { if (!done) { done = true; resolve(v); } }
      tasks.forEach(function (t) { Promise.resolve().then(t).then(finish, function () { }); });
      setTimeout(function () { finish(null); }, ms || 6000);
    });
  }

  async function locateByIP() {
    var d = await getJSON('https://ipwho.is/?lang=zh-CN');
    if (d && d.success !== false && isFinite(d.latitude)) {
      return { city: d.city || d.region || '', lat: d.latitude, lon: d.longitude };
    }
    return null;
  }

  /* 源 1：Open-Meteo（经纬度） */
  async function viaOpenMeteo(lat, lon) {
    var d = await getJSON('https://api.open-meteo.com/v1/forecast?latitude=' + lat + '&longitude=' + lon +
      '&current=temperature_2m,weather_code&timezone=auto');
    var cur = (d && d.current) || {};
    if (!isFinite(cur.temperature_2m)) throw new Error('no data');
    var code = typeof cur.weather_code === 'number' ? cur.weather_code : 3;
    return { temp: Math.round(cur.temperature_2m * 10) / 10, code: code, text: WEATHER_TEXT[code] || '多云' };
  }

  /* 源 2：wttr.in（经纬度或城市名，自带中文） */
  async function viaWttr(target) {
    var d = await getJSON('https://wttr.in/' + encodeURIComponent(target) + '?format=j1&lang=zh');
    var cur = d && d.current_condition && d.current_condition[0];
    if (!cur) throw new Error('no data');
    var temp = parseFloat(cur.temp_C);
    var wwo = parseInt(cur.weatherCode, 10);
    var desc = cur.lang_zh && cur.lang_zh[0] && cur.lang_zh[0].value;
    if (!desc && cur.weatherDesc && cur.weatherDesc[0]) desc = cur.weatherDesc[0].value;
    var city = '';
    try { city = d.nearest_area[0].areaName[0].value; } catch (e) { city = ''; }
    return {
      temp: Math.round(temp * 10) / 10,
      code: wwo,
      text: hasCJK(desc) ? desc : (WWO_TEXT[wwo] || '多云'),
      city: city
    };
  }

  /* 源 3：国内天气接口（城市名） */
  async function viaVvhan(city) {
    var d = await getJSON('https://api.vvhan.com/api/weather?city=' + encodeURIComponent(city) + '&type=json');
    if (!d || d.success === false || !d.data) throw new Error('no data');
    var t = parseFloat(d.data.tem);
    if (!isFinite(t)) throw new Error('no data');
    var text = d.data.wea || '多云';
    return { temp: t, code: 3, text: text, city: (d.city || city) };
  }

  async function geocodeCity(city) {
    var tries = [city, String(city).replace(/(市|省|区|县)$/, '')];
    for (var i = 0; i < tries.length; i++) {
      if (!tries[i]) continue;
      try {
        var d = await getJSON('https://geocoding-api.open-meteo.com/v1/search?count=1&language=zh&format=json&name=' + encodeURIComponent(tries[i]));
        if (d && d.results && d.results.length) {
          return { city: d.results[0].name || city, lat: d.results[0].latitude, lon: d.results[0].longitude };
        }
      } catch (e) { }
    }
    throw new Error('city not found');
  }

  async function weatherPayload(mode, city) {
    var cached = readCache();
    if (cached) return build(cached);

    var source = (mode === 'manual' && city) ? 'manual' : 'ip';
    var found = null;

    if (source === 'manual') {
      found = await firstOk([
        function () { return viaWttr(city).then(function (r) { r.city = r.city || city; return r; }); },
        function () { return viaVvhan(city); },
        function () { return geocodeCity(city).then(function (g) { return viaOpenMeteo(g.lat, g.lon).then(function (r) { r.city = g.city; return r; }); }); }
      ], 6000);
    } else {
      var loc = await firstOk([locateByIP], 3000);
      if (loc) {
        found = await firstOk([
          function () { return viaOpenMeteo(loc.lat, loc.lon).then(function (r) { r.city = loc.city; return r; }); },
          function () { return viaWttr(loc.lat + ',' + loc.lon).then(function (r) { r.city = r.city || loc.city; return r; }); }
        ], 7000);
        if (found && !hasCJK(found.city) && loc.city) found.city = loc.city;
        if (found && !found.city) found.city = loc.city || '当前位置';
      }
      if (!found) {
        var dc = defaultCity();
        found = await firstOk([
          function () { return viaWttr(dc); },
          function () { return viaVvhan(dc); },
          function () { return geocodeCity(dc).then(function (g) { return viaOpenMeteo(g.lat, g.lon).then(function (r) { r.city = g.city; return r; }); }); }
        ], 6000);
      }
    }

    if (found) {
      var out = { city: found.city || (city || defaultCity()), temp: found.temp, code: found.code, text: found.text, source: source };
      writeCache(out);
      return build(out);
    }
    var any = readCacheAny();
    if (any) return build(any);
    return {
      success: false, error: '天气获取失败', location_source: source, city: city || '',
      temperature: null, weather_code: null, weather_text: '',
      observed_at: fmtMinute(new Date()), updated_at: nowSec(), provider: 'Open-Meteo'
    };
  }


  var MUNICIPALITY = { '北京': '北京市', '上海': '上海市', '天津': '天津市', '重庆': '重庆市' };
  function cityLabel(c) {
    c = String(c || '').trim();
    return MUNICIPALITY[c] || c || '当前位置';
  }

  function build(o) {
    return {
      success: true,
      location_source: o.source || 'ip',
      city: cityLabel(o.city),
      temperature: o.temp,
      weather_code: o.code,
      weather_text: o.text || WEATHER_TEXT[o.code] || '多云',
      observed_at: fmtMinute(new Date()),
      updated_at: nowSec(),
      provider: 'Open-Meteo / wttr.in'
    };
  }

  /* ---------- 接口路由 ---------- */
  function apiResponse(action, params, postBody) {
    switch (action) {
      case 'get':
        return { success: true, links: S.links || [] };
      case 'getSettings':
        return { success: true, settings: SET };
      case 'getApks':
        return { success: true, apks: S.apks || [] };
      case 'getAnnouncement':
        return { success: true, announcement: S.announcement || {} };
      case 'getStaticSnapshot':
        return { success: true, snapshot: S };
      case 'getClientDataVersion':
        return {
          success: true,
          version: D.version || 'local',
          music: D.music || {},
          updated_at: D.updated_at || ''
        };
      case 'getMusicConfig':
        return Object.assign({ success: true }, D.music || {});
      case 'musicUrl': {
        var list = (D.music && D.music.music_playlist) || [];
        var id = params.get('id');
        var item = null;
        for (var i = 0; i < list.length; i++) { if (('' + list[i].id) === ('' + id)) { item = list[i]; break; } }
        if (item && item.url) return { success: true, url: item.url, id: id };
        return { success: false, error: '这首歌曲暂不可播放，可能受版权或音源限制，请换一首' };
      }
      case 'siteMetrics': {
        var base = Number(SET.footer_users_base || 0);
        var started = Number(SET.footer_started_at || 0);
        return { success: true, metrics: { started_at: started, server_time: nowSec(), users: base } };
      }
      case 'getOrCreateApkSharePage':
        return { success: false, error: '本地版本不支持生成分享页' };
      default:
        return { success: true, action: action, data: {} };
    }
  }

  function handleApi(url, params) {
    return jsonResponse(apiResponse(params.get('action') || '', params));
  }

  function handleOnline(params) {
    var action = params.get('action') || '';
    var now = new Date();
    var t = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()) + ' ' +
      pad(now.getHours()) + ':' + pad(now.getMinutes()) + ':' + pad(now.getSeconds());
    if (action === 'latency') return jsonResponse({ success: true, server_time: t, server_ts: nowSec() });
    if (action === 'ping') {
      var n = 1 + (Math.floor(Date.now() / 3600000) % 4);
      return jsonResponse({
        success: true, online: n,
        stats: { online: n, ttl: 180, active_since: t, updated_at: t, pages: [{ page: '/', count: n }], devices: { desktop: n, mobile: 0, tablet: 0 } }
      });
    }
    return jsonResponse({ success: true, server_time: t, server_ts: nowSec() });
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function handleLicense() {
    var t = nowSec();
    return jsonResponse({
      success: true,
      authorized: true,
      message: '站点授权有效',
      server_time: t,
      lease_until: t + 86400,
      lease_remaining: 86400,
      remaining_seconds: 86400,
      next_check_at: t + 3600,
      refresh_at: t + 3600,
      refresh_after: 3600,
      check_interval: 30,
      expires_at: 0,
      cached: false,
      features: { music: true, settings: true, teaching: true, apk: true, apps: true, templates: true, links: true, traffic: true, sync: true },
      feature_flags: { music: true, settings: true, teaching: true, apk: true, apps: true, templates: true, links: true, traffic: true, sync: true },
      policy: { mode: 'normal', revision: 3, updates_allowed: true },
      updates_allowed: true,
      offline_permanent: false,
      confirmation_pending: false,
      definitive_denial: false,
      retry_after: 0
    });
  }

  function handleWeather(params) {
    var mode = params.get('mode') || 'ip';
    var city = params.get('city') || '';
    var p = (mode === 'manual' && city) ? weatherPayload('manual', city) : warmWeather();
    return p.then(function (d) { return jsonResponse(d); })
      .catch(function (err) {
        return jsonResponse({ success: false, error: '天气获取失败' });
      });
  }

  var __weatherPromise = null;
  function warmWeather() {
    if (!__weatherPromise) {
      __weatherPromise = weatherPayload(
        (SET.page_builder && SET.page_builder.weather_mode === 'manual') ? 'manual' : 'ip',
        (SET.page_builder && SET.page_builder.weather_city) || ''
      );
    }
    return __weatherPromise;
  }

  var realFetch = window.fetch ? window.fetch.bind(window) : null;

  function route(url, params, postBody) {
    var path = url.pathname.split('/').pop().toLowerCase();
    if (path === 'api.php') return handleApi(url, params);
    if (path === 'weather.php') return handleWeather(params);
    if (path === 'online.php') return handleOnline(params);
    if (path === 'license_status.php') return handleLicense();
    if (path === 'license_asset.php') return jsonResponse({ success: true, asset: '', data: '', authorized: true });
    if (path === 'ip.php') return jsonResponse({ ip: '127.0.0.1', type: 'local', page: params.get('page') || '/', status: 'local' });
    return null;
  }

  try { setTimeout(warmWeather, 0); } catch (e) { }

  window.fetch = function (input, init) {
    try {
      var rawUrl = typeof input === 'string' ? input : (input && input.url) || '';
      var u = new URL(rawUrl, location.href);
      if (u.origin === location.origin) {
        var r = route(u, u.searchParams, init && init.body);
        if (r) return Promise.resolve(r);
      }
    } catch (e) { /* 返回真实 fetch */ }
    return realFetch ? realFetch(input, init) : Promise.reject(new Error('no fetch'));
  };

  /* XHR 兜底（部分老代码用 XMLHttpRequest） */
  var RealXHR = window.XMLHttpRequest;
  function LocalXHR() {
    var xhr = new RealXHR();
    var shadow = { _url: '', _method: 'GET' };
    var open = xhr.open, send = xhr.send;
    xhr.open = function (m, u) { shadow._method = m; shadow._url = u; return open.apply(xhr, arguments); };
    xhr.send = function (body) {
      try {
        var u = new URL(shadow._url, location.href);
        if (u.origin === location.origin) {
          var resp = route(u, u.searchParams, body);
          if (resp) {
            resp.then(function (res) { return res.text(); }).then(function (text) {
              Object.defineProperty(xhr, 'readyState', { value: 4, configurable: true });
              Object.defineProperty(xhr, 'status', { value: 200, configurable: true });
              Object.defineProperty(xhr, 'responseText', { value: text, configurable: true });
              Object.defineProperty(xhr, 'response', { value: text, configurable: true });
              if (typeof xhr.onreadystatechange === 'function') xhr.onreadystatechange();
              if (typeof xhr.onload === 'function') xhr.onload();
            });
            return;
          }
        }
      } catch (e) { }
      return send.apply(xhr, arguments);
    };
    return xhr;
  }
  LocalXHR.prototype = RealXHR.prototype;
  window.XMLHttpRequest = LocalXHR;
})();
