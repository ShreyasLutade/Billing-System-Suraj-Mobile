/**
 * The shop shown in the app. The demo login (user.demo) shows a neutral
 * demo shop, never the real shop's name, city or number.
 */
let demo = false;

export function setDemoBrand(on: boolean) {
  demo = on;
}

export function brand() {
  return demo
    ? { name: "Demo Mobile Shop", city: "Your City", phone: "9999999999", icon: null as string | null, demo: true }
    : { name: "Suraj Mobile", city: "Balaghat", phone: "9516533556", icon: "/suraj_mobile_icon.png" as string | null, demo: false };
}
