import { useMemo } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import {
  PurchaseEntryModal,
  type PurchasePrefill,
} from "../components/PurchaseEntryModal";
import type { Supplier } from "../types";

export type AddStockLocationState = {
  condition?: "NEW" | "USED";
  prefill?: PurchasePrefill | null;
  supplierId?: string | null;
  supplierName?: string | null;
};

export function AddStockPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const state = (location.state || null) as AddStockLocationState | null;

  const condition: "NEW" | "USED" = useMemo(() => {
    if (state?.condition === "USED" || state?.condition === "NEW") {
      return state.condition;
    }
    const fromQuery = searchParams.get("condition");
    return fromQuery === "USED" ? "USED" : "NEW";
  }, [state?.condition, searchParams]);

  const fixedSupplier: Supplier | null = useMemo(() => {
    if (!state?.supplierId || !state?.supplierName) return null;
    return {
      id: state.supplierId,
      name: state.supplierName,
      purchaseCount: 0,
      totalPurchased: 0,
      totalPaid: 0,
      outstanding: 0,
      stockAvailable: 0,
      stockSold: 0,
      stockPurchased: 0,
      createdAt: "",
      updatedAt: "",
    };
  }, [state?.supplierId, state?.supplierName]);

  function goBackToStock() {
    navigate("/stock", { replace: true, state: { condition } });
  }

  return (
    <PurchaseEntryModal
      layout="page"
      condition={condition}
      fixedSupplier={fixedSupplier}
      prefill={state?.prefill || null}
      onClose={goBackToStock}
      onCreated={goBackToStock}
    />
  );
}
