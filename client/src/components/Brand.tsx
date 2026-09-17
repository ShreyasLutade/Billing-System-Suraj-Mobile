import clsx from "clsx";
import { useTheme } from "../theme/ThemeContext";

/** App icon (SVG preferred). PNG fallback for older browsers. */
export function BrandIcon({
  className,
  alt = "Smart Billing",
}: {
  className?: string;
  alt?: string;
}) {
  return (
    <img
      src="/smart_billing_icon.svg"
      alt={alt}
      className={clsx("object-contain", className)}
      onError={(event) => {
        const img = event.currentTarget;
        if (!img.src.endsWith(".png")) {
          img.src = "/smart_billing_icon.png";
        }
      }}
    />
  );
}

/** Horizontal logo — theme-aware light/dark SVG. */
export function BrandLogo({
  className,
  alt = "Smart Billing",
}: {
  className?: string;
  alt?: string;
}) {
  const { theme } = useTheme();
  const src =
    theme === "dark"
      ? "/smart_billing_logo_dark.svg"
      : "/smart_billing_logo_light.svg";
  const fallback =
    theme === "dark"
      ? "/smart_billing_logo_dark.png"
      : "/smart_billing_logo_light.png";

  return (
    <img
      src={src}
      alt={alt}
      className={clsx("object-contain object-left", className)}
      onError={(event) => {
        const img = event.currentTarget;
        if (img.src !== fallback && !img.src.endsWith(fallback)) {
          img.src = fallback;
        }
      }}
    />
  );
}

export const BRAND_NAME = "Smart Billing";
