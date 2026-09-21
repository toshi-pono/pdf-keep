import { msg } from "../../src/shared/messages";
import test from "node:test";
import assert from "node:assert/strict";
import {
  downloadGoogleFont,
  googleFontURL,
  googleFontFamilyCount,
} from "../../src/fonts/google-fonts";
import { errorMessage } from "../../src/shared/errors";
const font = {
  family: "Inter",
  style: "Regular",
  weight: 400,
  italic: false,
  characters: "秘密の文章",
};
test("Inter downloads directly from CDN without CSS, CORS-blocked catalog or document text", async () => {
  let count = 0;
  const request = (async (url: string, init: unknown) => {
    count++;
    assert.equal(init, undefined);
    assert.equal(new URL(url).hostname, "fonts.gstatic.com");
    assert(!url.includes(encodeURIComponent(font.characters)));
    assert.match(url, /\.ttf$/);
    return new Response(new Uint8Array(20));
  }) as typeof fetch;
  assert.equal((await downloadGoogleFont(font, request)).length, 20);
  assert.equal(count, 1);
});
test("catalog resolves exact weights and italics for common English and Japanese fonts", () => {
  assert(googleFontFamilyCount > 1900);
  for (const family of ["Inter", "Roboto", "Noto Sans JP", "M PLUS 1p"]) {
    const regular = googleFontURL({ ...font, family });
    const bold = googleFontURL({ ...font, family, weight: 700 });
    assert.notEqual(regular, bold);
  }
  assert.notEqual(
    googleFontURL(font),
    googleFontURL({ ...font, italic: true }),
  );
  assert.throws(
    () => googleFontURL({ ...font, family: "Private Font" }),
    /errors.googleFontUnsupported/,
  );
  assert.throws(
    () => googleFontURL({ ...font, weight: 405 }),
    /errors.googleFontUnsupported/,
  );
});
test("catalog accepts legacy family names without substituting widths or unavailable styles", () => {
  for (const [alias, family] of [
    ["noto-sans_jp", "Noto Sans JP"],
    ["Noto Sans JP Thin", "Noto Sans JP"],
    ["Nunito Sans 12pt ExtraLight 12pt", "Nunito Sans"],
    ["DM Sans 9pt", "DM Sans"],
    ["Rounded Mplus 1c", "M PLUS Rounded 1c"],
  ]) {
    assert.equal(
      googleFontURL({ ...font, family: alias }),
      googleFontURL({ ...font, family }),
    );
  }
  assert.notEqual(
    googleFontURL({ ...font, family: "Roboto Condensed" }),
    googleFontURL({ ...font, family: "Roboto" }),
  );
  assert.throws(
    () => googleFontURL({ ...font, family: "Noto Sans JP Thin", italic: true }),
    /errors.googleFontUnsupported/,
  );
  assert.throws(
    () => googleFontURL({ ...font, family: "Inter Condensed" }),
    /errors.googleFontUnsupported/,
  );
});
test("Figma's plain-object failures are readable and downloads can be retried", async () => {
  assert.equal(errorMessage({ message: "Failed to fetch" }), "Failed to fetch");
  const request = (async () => {
    throw { message: "Failed to fetch" };
  }) as typeof fetch;
  await assert.rejects(downloadGoogleFont(font, request), (error: unknown) => {
    assert.deepEqual(
      errorMessage(error),
      msg("errors.googleFontConnection", { reason: "Failed to fetch" }),
    );
    return true;
  });
  await assert.rejects(
    downloadGoogleFont(
      font,
      (async () => new Response("", { status: 404 })) as typeof fetch,
    ),
    (error: unknown) => {
      assert.deepEqual(
        errorMessage(error),
        msg("errors.googleFontHttp", { status: 404 }),
      );
      return true;
    },
  );
  assert.equal(
    (
      await downloadGoogleFont(
        font,
        (async () => new Response(new Uint8Array(20))) as typeof fetch,
      )
    ).length,
    20,
  );
});
