import { chromium } from "playwright";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";

// Render the real built UI so published screenshots track product changes.
// Figma Community's recommended thumbnail size is 1920 × 1080 px.
const work = "tmp/promo";
await mkdir(work, { recursive: true });
const pngURL = (bytes) => `data:image/png;base64,${bytes.toString("base64")}`;
const logo = pngURL(await readFile("assets/logo.png"));
const font = (
  await readFile("tests/fixtures/fonts/Inter-Full-Regular.ttf")
).toString("base64");
const browser = await chromium.launch({ headless: true });
try {
  const ui = await browser.newPage({
    viewport: { width: 480, height: 680 },
    locale: "en-US",
    deviceScaleFactor: 2,
  });
  const errors = [];
  ui.on("pageerror", (e) => errors.push(e.message));
  await ui.setContent(await readFile("dist/ui.html", "utf8"));
  await ui.evaluate(() =>
    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          pluginMessage: {
            type: "selection",
            valid: true,
            name: "Paper / Figure 1",
            revision: 1,
            width: 1920,
            height: 1080,
            fonts: [],
            diagnostics: [],
          },
        },
      }),
    ),
  );
  await ui
    .locator("#selection")
    .filter({ hasText: "Paper / Figure 1" })
    .waitFor();
  assert.equal(
    await ui.locator('[data-quality="medium"]').getAttribute("aria-pressed"),
    "true",
  );
  assert.equal(await ui.locator("#scale-hint").textContent(), "2481 × 1396 px");
  assert(await ui.locator("#scale").isHidden());
  await ui.mouse.move(0, 0);
  const shot = pngURL(await ui.screenshot({ path: `${work}/ui-en.png` }));
  const quality = pngURL(
    await ui
      .locator(".quality-section")
      .screenshot({ path: `${work}/quality-en.png` }),
  );

  const css = `
    @font-face{font-family:PromoInter;src:url(data:font/ttf;base64,${font})}
    *{box-sizing:border-box}body{margin:0;color:#18243d;background:#f7f9fc;font-family:PromoInter,Arial,sans-serif;-webkit-font-smoothing:antialiased}
    .slide{width:1920px;height:1080px;position:relative;padding:72px 100px;overflow:hidden}
    .brand{display:flex;align-items:center;gap:18px;font-size:36px;font-weight:700;letter-spacing:-1px}
    .brand img{width:56px;height:56px;mix-blend-mode:multiply}
    .eyebrow{color:#1769ef;font-size:17px;letter-spacing:2.5px;font-weight:700}
    h1,h2,h3,p{margin:0}h1{font-size:72px;line-height:1.23;letter-spacing:-2.7px;font-weight:700}
    .blue{color:#1769ef}.muted{color:#64728a}
    .platform{position:absolute;left:100px;bottom:72px;font-size:16px;letter-spacing:2.6px;color:#7b8799}
    .hero .eyebrow{margin:92px 0 24px}
    .description{font-size:25px;line-height:1.65;color:#64728a;margin-top:34px}
    .features{display:grid;gap:22px;margin-top:48px;font-size:23px;color:#455570}
    .features div{display:flex;align-items:center;gap:22px}.features span{font-size:15px;letter-spacing:1px;font-weight:700;color:#1769ef}
    .shot{position:absolute;right:112px;top:114px;width:592px;border:1px solid #dce3ee;border-radius:16px;background:white;overflow:hidden;box-shadow:0 24px 70px #273d6012}
    .shot img{display:block;width:100%;height:auto}
    .feature-header{display:flex;justify-content:space-between;align-items:center}
    .sub h1{margin-top:54px;font-size:61px;letter-spacing:-2px}
    .sub .lead{font-size:25px;color:#64728a;margin-top:16px}
    .cards{display:grid;grid-template-columns:repeat(3,1fr);gap:28px;margin-top:44px}
    .card{height:536px;background:white;border:1px solid #dee5ef;border-radius:20px;padding:30px 30px 28px}
    .card-top{display:flex;align-items:center;gap:12px;color:#1769ef;font-weight:700;font-size:15px;letter-spacing:1.3px}
    .number{display:grid;place-items:center;width:34px;height:34px;border-radius:10px;background:#edf4ff;letter-spacing:0}
    .art{height:252px;position:relative;margin-top:22px;display:flex;align-items:center;justify-content:center}
    .card h2{font-size:29px;line-height:1.25;letter-spacing:-.8px;margin-top:18px}
    .card p{font-size:21px;line-height:1.6;color:#64728a;margin-top:16px}
    .sub-footer{position:absolute;bottom:72px;left:100px;right:100px;border-top:1px solid #dce3ee;padding-top:28px;display:flex;justify-content:space-between;align-items:center;font-size:20px;color:#64728a}
    .workflow{display:flex;gap:20px;align-items:center;color:#455570}.workflow span{color:#1769ef}
    .sheet{position:absolute;border:1.5px solid #cdd9ed;background:white;border-radius:10px;width:158px;height:178px;padding:15px}
    .sheet svg{width:100%;height:100%}.back{left:0;top:26px;transform:rotate(-9deg);background:#edf3fe}.middle{left:13px;top:34px;transform:rotate(-4deg)}
    .front{left:26px;top:44px}.flat{right:3px;top:44px;border-color:#8fb4f5;background:#fbfdff}
    .arrow{color:#1769ef;font-size:38px;position:absolute;top:102px;left:213px}
    .diagram-label{position:absolute;bottom:0;font-size:17px;color:#64728a;text-align:center;width:180px}
    .paper-text{border:1px solid #d8e2f1;border-radius:12px;padding:26px 25px;width:100%;background:#fbfdff}
    .search{font-size:17px;background:white;border:1px solid #dce3ee;border-radius:7px;display:flex;gap:10px;align-items:center;color:#64728a;padding:8px 12px;margin-bottom:25px;width:205px}
    .search svg{width:18px;height:18px}.text-title{font-size:27px;line-height:1.5;color:#18243d;letter-spacing:-.7px;white-space:nowrap}
    .highlight{background:#dceaff;border-bottom:2px solid #1769ef;color:#1769ef;padding:2px 3px}
    .text-line{font-size:18px;line-height:1.7;color:#64728a;margin-top:10px}
    .quality-art{flex-direction:column;gap:26px}
    .quality-shot{width:100%;border:1px solid #dce3ee;border-radius:12px;padding:18px;background:white}
    .quality-shot img{width:100%;display:block}
    .papers{display:flex;gap:10px;align-items:center;color:#64728a;font-size:16px}.papers b{padding:6px 14px;border:1px solid #dce3ee;border-radius:6px;background:white;font-weight:500}
  `;
  const brand = `<div class="brand"><img src="${logo}" alt="">PDF Keep</div>`;
  const chart = `<svg viewBox="0 0 126 148" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="0" width="62" height="5" rx="2" fill="#243655"/><rect y="14" width="96" height="3" rx="1" fill="#c9d4e5"/><rect y="30" width="126" height="76" rx="5" fill="#edf4ff"/><path d="M9 93L34 74L61 83L91 49L117 58" fill="none" stroke="#1769ef" stroke-width="4" stroke-linejoin="round"/><path d="M9 98L34 91L61 96L91 78L117 85" fill="none" stroke="#8cb7f6" stroke-width="3"/><rect y="118" width="126" height="4" rx="2" fill="#c9d4e5"/><rect y="130" width="105" height="4" rx="2" fill="#dce3ee"/><rect y="142" width="74" height="4" rx="2" fill="#dce3ee"/></svg>`;
  const cover = `<main class="slide hero">
    ${brand}<div class="eyebrow">FOR PAPERS, POSTERS &amp; FIGURES</div>
    <h1>Flatten backgrounds.<br>Keep useful text.<br><span class="blue">Share lighter PDFs.</span></h1>
    <p class="description">Combine images and shapes into one background.<br>Save your PDF directly from Figma.</p>
    <div class="features">
      <div><span>01</span>Keep supported text searchable and copyable</div>
      <div><span>02</span>Choose paper-aware image quality</div>
      <div><span>03</span>Compress images and subset embedded fonts</div>
    </div>
    <div class="shot"><img src="${shot}" alt="PDF Keep interface with Medium quality selected"></div>
    <div class="platform">FLATTEN &amp; COMPRESS · FOR FIGMA</div>
  </main>`;
  const sub = `<main class="slide sub">
    <div class="feature-header">${brand}<div class="eyebrow">BUILT FOR YOUR FINAL EXPORT</div></div>
    <h1>Smaller PDFs. More useful text.</h1>
    <p class="lead">A simpler background, readable text and just the resolution you need.</p>
    <section class="cards">
      <article class="card"><div class="card-top"><span class="number">01</span> FLATTEN</div>
        <div class="art"><div class="sheet back"></div><div class="sheet middle"></div><div class="sheet front">${chart}</div><span class="arrow">→</span><div class="sheet flat">${chart}</div><span class="diagram-label" style="left:14px">Images &amp; shapes</span><span class="diagram-label" style="right:-8px">One background</span></div>
        <h2>Combine the background.</h2><p>Bake images, crops and shapes into one losslessly compressed background.</p>
      </article>
      <article class="card"><div class="card-top"><span class="number">02</span> KEEP TEXT</div>
        <div class="art"><div class="paper-text"><div class="search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/></svg>Results</div><div class="text-title">Figure 1. <span class="highlight">Results</span></div><div class="text-line">Mean accuracy across five runs.<br>Compare, search and copy.</div></div></div>
        <h2>Keep words useful.</h2><p>Preserve supported text for searching and copying. Subset fonts to save space.</p>
      </article>
      <article class="card"><div class="card-top"><span class="number">03</span> CHOOSE QUALITY</div>
        <div class="art quality-art"><div class="quality-shot"><img src="${quality}" alt="Sharp, Medium, Light and Manual image quality controls"></div><div class="papers"><b>A4</b><b>A1</b><b>A0</b><span>and more</span></div></div>
        <h2>From papers to posters.</h2><p>Start at A4, 300 dpi. Choose a poster size or fine-tune the resolution manually.</p>
      </article>
    </section>
    <footer class="sub-footer"><div class="workflow">Select a frame <span>→</span> Choose quality <span>→</span> Save PDF</div><span>Document processing stays on your device.</span></footer>
  </main>`;
  for (const [name, body] of [
    ["teaser-en", cover],
    ["subteaser-features-en", sub],
  ]) {
    const html = `<!doctype html><html lang="en"><meta charset="utf-8"><title>PDF Keep</title><style>${css}</style><body>${body}</body></html>`;
    await writeFile(`${work}/${name}.html`, html);
    const page = await browser.newPage({
      viewport: { width: 1920, height: 1080 },
      deviceScaleFactor: 1,
    });
    await page.setContent(html);
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all([...document.images].map((img) => img.decode()));
    });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth),
      1920,
    );
    for (const element of await page
      .locator("h1,h2,p,.features,.shot,.sub-footer,.cards")
      .all()) {
      const box = await element.boundingBox();
      assert(
        box &&
          box.x >= 0 &&
          box.y >= 0 &&
          box.x + box.width <= 1920 &&
          box.y + box.height <= 1080,
        `${name}: content outside canvas`,
      );
    }
    await page.screenshot({ path: `assets/${name}.png` });
    await page.close();
  }
  assert.deepEqual(errors, []);
  console.log(
    "Rendered assets/teaser-en.png and assets/subteaser-features-en.png (1920 × 1080)",
  );
} finally {
  await browser.close();
}
