import { FieldPicker } from "./FieldPicker";
import type { FinanceCompany } from "../types";

export const ADD_NEW_FINANCE = "__add_new__";

type Props = {
  companies: FinanceCompany[];
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  excludeIds?: string[];
};

export function FinanceCompanyPicker({
  companies,
  value,
  onChange,
  required,
  excludeIds = [],
}: Props) {
  const visibleCompanies = companies.filter(
    (company) => !excludeIds.includes(company.id) || company.id === value,
  );

  return (
    <FieldPicker
      value={value}
      onChange={onChange}
      placeholder="Select finance company"
      required={required}
      searchable
      searchPlaceholder="Search finance company…"
      options={[
        ...visibleCompanies.map((company) => ({
          value: company.id,
          label: company.name,
        })),
        ...(value === ADD_NEW_FINANCE
          ? [{ value: ADD_NEW_FINANCE, label: "+ Add new" }]
          : []),
      ]}
      footerAction={{
        label: "Add new finance company",
        onClick: () => onChange(ADD_NEW_FINANCE),
      }}
    />
  );
}
