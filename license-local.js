/* 本地授权模块：替代原云端授权校验（license_status.php / license_asset.php）
   自建站点无需联网校验，所有功能默认开启 */
(function () {
  'use strict';
  var FEATURES = {
    music: true, musicSettings: true, settings: true, app_settings: true,
    application_settings: true, teaching: true, teach_management: true,
    apk: true, app_build: true, apk_builder: true, app_generation: true,
    apps: true, applications: true, templates: true, template: true,
    appearance: true, links: true, traffic: true, sync: true, admin: true
  };
  var POLICY = { mode: 'normal', revision: 3, updates_allowed: true };
  var lease = { authorized: true, message: '站点授权有效' };

  function base(x) { return String(x || './'); }

  window.GuideLicense = {
    features: Object.assign({}, FEATURES),
    require: function (url) { return Promise.resolve(base(url)); },
    block: function () { return false; },
    getFeatures: function () { return Object.assign({}, FEATURES); },
    getPolicy: function () { return Object.assign({}, POLICY); },
    refresh: function (url) { return Promise.resolve(base(url)); },
    status: function () { return Object.assign({}, lease); },
    requireFeature: function () { return true; },
    has: function () { return true; }
  };

  window.__LOCAL_LICENSE__ = true;
  try { console.log('[授权] 本地授权模块已启用，功能全部开放'); } catch (e) { }
})();
