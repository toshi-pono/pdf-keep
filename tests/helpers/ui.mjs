export const deliverTo = (page, message) =>
  page.evaluate(async (m) => {
    if (m.type === "bundle") m.bundle.png = new Uint8Array(m.bundle.png);
    window.dispatchEvent(
      new MessageEvent("message", {
        source: null,
        data: { pluginMessage: m },
      }),
    );
    // External messages are batched by React; wait for the browser to commit.
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
  }, message);

export const font = {
  family: "M PLUS 1p",
  style: "Regular",
  weight: 400,
  italic: false,
  characters: "日本語",
};
