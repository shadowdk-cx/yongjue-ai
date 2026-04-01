/**
 * 涌觉电商 — Nano Banana 2 店铺图插件（纯脚本，无依赖）
 *
 * 用法：在店铺主题里先于本脚本设置配置，再引入：
 * <script>
 *   window.__ECOM_NB2_CONFIG__ = {
 *     apiOrigin: 'https://你的Next应用域名',
 *     secret: '与服务器环境变量 ECOM_SHOP_PLUGIN_SECRET 一致',
 *     imageSelector: 'img[data-ecom-nb2]',  // 可选，默认即此项
 *     language: 'zh'  // 可选 zh | en
 *   };
 * </script>
 * <script src="https://你的Next应用域名/ecom-nanobanana2-plugin.js" defer></script>
 *
 * 在需要支持「点击改版并替换」的商品图上添加：data-ecom-nb2
 * 例：<img src="..." alt="" data-ecom-nb2 />
 *
 * 服务器需配置：GEMINI_API_KEY、ECOM_SHOP_PLUGIN_SECRET；若店铺与 API 不同域，另设 ECOM_SHOP_PLUGIN_ORIGINS
 */
(function () {
  if (typeof window === 'undefined') return;

  var CFG = window.__ECOM_NB2_CONFIG__;
  if (!CFG || !CFG.apiOrigin || !CFG.secret) {
    console.warn('[ecom-nb2] 缺少 window.__ECOM_NB2_CONFIG__（apiOrigin、secret）');
    return;
  }

  var apiOrigin = String(CFG.apiOrigin).replace(/\/$/, '');
  var secret = String(CFG.secret);
  var imageSelector = CFG.imageSelector || 'img[data-ecom-nb2]';
  var language = CFG.language === 'en' ? 'en' : 'zh';

  var NS = 'ecom-nb2-root';
  if (document.getElementById(NS)) return;

  function blobToDataUrl(blob) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () {
        resolve(String(r.result || ''));
      };
      r.onerror = function () {
        reject(new Error('读取失败'));
      };
      r.readAsDataURL(blob);
    });
  }

  /** API 可能返回 data URL，或本站相对路径（如 /generated-images/xxx.png） */
  function resolveResultImageUrl(u) {
    if (!u) return '';
    if (u.indexOf('data:image/') === 0) return u;
    if (u.indexOf('https://') === 0 || u.indexOf('http://') === 0) return u;
    if (u.indexOf('/') === 0) return apiOrigin + u;
    return '';
  }

  function imgToDataUrl(img) {
    var src = img.currentSrc || img.src;
    if (src.indexOf('data:image/') === 0) return Promise.resolve(src);
    return fetch(src, { mode: 'cors', credentials: 'omit' })
      .then(function (res) {
        if (!res.ok) throw new Error('无法拉取图片');
        return res.blob();
      })
      .then(blobToDataUrl);
  }

  var root = document.createElement('div');
  root.id = NS;
  root.setAttribute('data-ecom-nb2-ui', '1');

  var css =
    '#' +
    NS +
    '{position:fixed;z-index:2147483646;font-family:system-ui,-apple-system,sans-serif;font-size:14px;}' +
    '#' +
    NS +
    ' .nb2-fab{position:fixed;right:16px;bottom:24px;padding:10px 16px;border-radius:999px;border:none;cursor:pointer;' +
    'background:linear-gradient(135deg,#111,#333);color:#fff;box-shadow:0 8px 24px rgba(0,0,0,.25);font-weight:600;}' +
    '#' +
    NS +
    ' .nb2-fab:hover{filter:brightness(1.08);}' +
    '#' +
    NS +
    ' .nb2-mask{position:fixed;inset:0;background:rgba(0,0,0,.35);z-index:2147483645;}' +
    '#' +
    NS +
    ' .nb2-panel{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);width:min(420px,92vw);max-height:85vh;' +
    'overflow:auto;background:#fff;border-radius:16px;box-shadow:0 24px 80px rgba(0,0,0,.3);padding:20px;z-index:2147483647;}' +
    '#' +
    NS +
    ' .nb2-panel h3{margin:0 0 12px;font-size:17px;}' +
    '#' +
    NS +
    ' .nb2-panel textarea{width:100%;min-height:88px;box-sizing:border-box;padding:10px;border:1px solid #ddd;border-radius:10px;resize:vertical;}' +
    '#' +
    NS +
    ' .nb2-row{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px;}' +
    '#' +
    NS +
    ' .nb2-chip{padding:6px 10px;border-radius:8px;border:1px solid #e0e0e0;background:#f7f7f7;cursor:pointer;font-size:12px;}' +
    '#' +
    NS +
    ' .nb2-chip:hover{background:#eee;}' +
    '#' +
    NS +
    ' .nb2-actions{display:flex;gap:10px;margin-top:14px;flex-wrap:wrap;}' +
    '#' +
    NS +
    ' .nb2-btn{padding:10px 16px;border-radius:10px;border:none;cursor:pointer;font-weight:600;}' +
    '#' +
    NS +
    ' .nb2-primary{background:#111;color:#fff;}' +
    '#' +
    NS +
    ' .nb2-primary:disabled{opacity:.5;cursor:not-allowed;}' +
    '#' +
    NS +
    ' .nb2-ghost{background:#f0f0f0;color:#111;}' +
    '#' +
    NS +
    ' .nb2-preview{max-width:100%;max-height:160px;border-radius:10px;margin-top:10px;border:1px solid #eee;}' +
    '#' +
    NS +
    ' .nb2-hint{margin-top:8px;color:#666;font-size:12px;line-height:1.5;}' +
    '#' +
    NS +
    ' .nb2-err{color:#b00020;font-size:13px;margin-top:8px;}' +
    '#' +
    NS +
    ' .nb2-mode label{margin-right:12px;cursor:pointer;font-size:13px;}';

  var style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  var state = {
    pickMode: false,
    targetImg: null,
    panelOpen: false,
  };

  var fab = document.createElement('button');
  fab.className = 'nb2-fab';
  fab.type = 'button';
  fab.textContent = language === 'zh' ? 'AI 主图 (NB2)' : 'AI image (NB2)';

  function closePanel() {
    state.panelOpen = false;
    var old = root.querySelector('.nb2-mask');
    var pan = root.querySelector('.nb2-panel');
    if (old) old.remove();
    if (pan) pan.remove();
    document.body.style.cursor = '';
    state.pickMode = false;
    state.targetImg = null;
  }

  function openPanel(img) {
    state.targetImg = img;
    state.panelOpen = true;
    state.pickMode = false;
    document.body.style.cursor = '';

    var mask = document.createElement('div');
    mask.className = 'nb2-mask';

    var panel = document.createElement('div');
    panel.className = 'nb2-panel';

    var title = language === 'zh' ? 'Nano Banana 2 · 改版并替换' : 'Nano Banana 2 · Remix & replace';
    panel.innerHTML =
      '<h3>' +
      title +
      '</h3>' +
      '<div class="nb2-mode"><label><input type="radio" name="nb2m" value="remix" checked/> ' +
      (language === 'zh' ? '主题改版（换场景/背景等）' : 'Remix') +
      '</label><label><input type="radio" name="nb2m" value="refine"/> ' +
      (language === 'zh' ? '精修（保持构图）' : 'Refine') +
      '</label></div>' +
      '<p class="nb2-hint">' +
      (language === 'zh'
        ? '说明越具体效果越稳。生成成功后当前这张展示图会被替换为新图（仅浏览器内，需自行保存到店铺后台）。'
        : 'Be specific. The image on this page will be replaced.') +
      '</p>' +
      '<textarea id="nb2-ta" placeholder="' +
      (language === 'zh' ? '例如：换成纯白底棚拍柔光，轻微倒影…' : 'Describe changes…') +
      '"></textarea>' +
      '<div class="nb2-row" id="nb2-presets"></div>' +
      '<div class="nb2-err" id="nb2-err" style="display:none"></div>' +
      '<img class="nb2-preview" id="nb2-prev" alt="" />' +
      '<div class="nb2-actions">' +
      '<button type="button" class="nb2-btn nb2-primary" id="nb2-go">' +
      (language === 'zh' ? '生成并替换' : 'Generate') +
      '</button>' +
      '<button type="button" class="nb2-btn nb2-ghost" id="nb2-cancel">' +
      (language === 'zh' ? '取消' : 'Cancel') +
      '</button></div>';

    root.appendChild(mask);
    root.appendChild(panel);

    var ta = panel.querySelector('#nb2-ta');
    var errEl = panel.querySelector('#nb2-err');
    var prev = panel.querySelector('#nb2-prev');
    var goBtn = panel.querySelector('#nb2-go');
    prev.src = img.currentSrc || img.src;

    var presetsZh = [
      ['换白底', '换成纯白电商主图背景，专业棚拍柔光，轻微自然倒影，产品居中'],
      ['生活场景', '换成温馨家居生活场景，自然窗光，保持产品清晰'],
      ['去杂乱', '去掉背景杂物与脏点，背景干净简约，主体更突出'],
      ['加强质感', '加强材质质感与清晰度，整体更通透，仍保持同一产品'],
    ];
    var presetsEn = [
      ['White bg', 'Clean white e-commerce background, soft studio light, subtle reflection, product centered'],
      ['Lifestyle', 'Cozy home lifestyle scene, natural window light, product sharp'],
      ['Clean bg', 'Remove clutter and distractions, minimal background'],
      ['Sharper', 'Enhance material texture and clarity, same product'],
    ];
    var presets = language === 'zh' ? presetsZh : presetsEn;
    var prow = panel.querySelector('#nb2-presets');
    presets.forEach(function (p) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'nb2-chip';
      b.textContent = p[0];
      b.addEventListener('click', function () {
        ta.value = p[1];
      });
      prow.appendChild(b);
    });

    function showErr(msg) {
      errEl.style.display = msg ? 'block' : 'none';
      errEl.textContent = msg || '';
    }

    mask.addEventListener('click', closePanel);
    panel.querySelector('#nb2-cancel').addEventListener('click', closePanel);

    goBtn.addEventListener('click', function () {
      var instr = (ta.value || '').trim();
      if (!instr) {
        showErr(language === 'zh' ? '请填写说明' : 'Enter instruction');
        return;
      }
      var modeInput = panel.querySelector('input[name="nb2m"]:checked');
      var mode = modeInput && modeInput.value === 'refine' ? 'refine' : 'remix';
      showErr('');
      goBtn.disabled = true;

      imgToDataUrl(img)
        .then(function (dataUrl) {
          return fetch(apiOrigin + '/api/shop/plugin-image', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: 'Bearer ' + secret,
            },
            body: JSON.stringify({
              imageDataUrl: dataUrl,
              instruction: instr,
              mode: mode,
              language: language,
            }),
          });
        })
        .then(function (res) {
          return res.json().then(function (data) {
            if (!res.ok) throw new Error(data.error || '请求失败');
            return data;
          });
        })
        .then(function (data) {
          var url = resolveResultImageUrl(data.url);
          if (!url) throw new Error('未返回图片');
          img.src = url;
          if (img.srcset) img.removeAttribute('srcset');
          if (img.sizes) img.removeAttribute('sizes');
          closePanel();
        })
        .catch(function (e) {
          var msg = e && e.message ? e.message : String(e);
          if (msg.indexOf('Failed to fetch') >= 0) {
            msg =
              language === 'zh'
                ? '网络失败：请检查 apiOrigin、店铺域名是否已写入 ECOM_SHOP_PLUGIN_ORIGINS'
                : 'Network error: check CORS / apiOrigin';
          }
          showErr(msg);
        })
        .finally(function () {
          goBtn.disabled = false;
        });
    });
  }

  function onDocClick(ev) {
    if (!state.pickMode) return;
    var t = ev.target;
    if (!t || !t.closest || t.closest('#' + NS)) return;
    if (t.tagName !== 'IMG') return;
    if (!t.matches(imageSelector)) return;
    ev.preventDefault();
    ev.stopPropagation();
    openPanel(t);
  }

  fab.addEventListener('click', function () {
    if (state.panelOpen) return;
    state.pickMode = !state.pickMode;
    if (state.pickMode) {
      document.body.style.cursor = 'crosshair';
      fab.textContent = language === 'zh' ? '点击商品图…' : 'Click a product image…';
    } else {
      document.body.style.cursor = '';
      fab.textContent = language === 'zh' ? 'AI 主图 (NB2)' : 'AI image (NB2)';
    }
  });

  document.addEventListener('click', onDocClick, true);

  root.appendChild(fab);
  document.body.appendChild(root);
})();
