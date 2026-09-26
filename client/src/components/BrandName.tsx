/** Shop name with its small "NX" mark on the baseline. */
export const BRAND_NAME = "Babu Mobile";
export const BRAND_SUFFIX = "NX";

/** Plain-text form for titles, share messages and aria labels. */
export const BRAND_NAME_TEXT = `${BRAND_NAME} ${BRAND_SUFFIX}`;

export function BrandName() {
  return (
    <>
      {BRAND_NAME}
      <span className="brand-suffix">{BRAND_SUFFIX}</span>
    </>
  );
}
