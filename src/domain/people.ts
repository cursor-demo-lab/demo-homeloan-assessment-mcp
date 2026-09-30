export type StaffRole = "home-lending-executive" | "credit-assessor" | "officer";

interface StaffShape {
  readonly id: string;
  readonly role: StaffRole;
  readonly title: string;
  readonly name: string;
}

/** Every staff member is fictional. Each role has exactly one person in the demo. */
export const STAFF = {
  sarah: {
    id: "staff-sarah-whitfield",
    role: "home-lending-executive",
    title: "Home Lending Executive",
    name: "Sarah Whitfield",
  },
  assessor: {
    id: "staff-priya-raman",
    role: "credit-assessor",
    title: "Credit assessor",
    name: "Priya Raman",
  },
  officer: {
    id: "staff-tom-nguyen",
    role: "officer",
    title: "Fulfilment officer",
    name: "Tom Nguyen",
  },
} as const satisfies Record<string, StaffShape>;

export type StaffMember = (typeof STAFF)[keyof typeof STAFF];
export type StaffId = StaffMember["id"];
export type StaffIdFor<R extends StaffRole> = Extract<StaffMember, { readonly role: R }>["id"];
