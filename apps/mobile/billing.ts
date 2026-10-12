import { Platform } from "react-native";
import Purchases, {
  type PurchasesPackage,
  type PurchasesError,
} from "react-native-purchases";
const publicKey =
  Platform.OS === "ios"
    ? process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY
    : process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY;
let configured = false;
export const nativeBillingAvailable = Boolean(publicKey);
export async function packagesFor(userId: string): Promise<PurchasesPackage[]> {
  if (!publicKey) return [];
  if (!configured) {
    Purchases.configure({ apiKey: publicKey, appUserID: userId });
    configured = true;
  } else if ((await Purchases.getAppUserID()) !== userId)
    await Purchases.logIn(userId);
  const offerings = await Purchases.getOfferings();
  return (offerings.current?.availablePackages ?? []).filter((p) =>
    ["yeoun.light.500", "yeoun.light.1200"].includes(p.product.identifier),
  );
}
export async function purchase(item: PurchasesPackage) {
  try {
    await Purchases.purchasePackage(item);
    return true;
  } catch (error) {
    if ((error as PurchasesError).userCancelled) return false;
    throw error;
  }
}
