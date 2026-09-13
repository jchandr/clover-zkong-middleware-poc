import { getZkongToken } from "../services/zkong/auth";
import { zkongClient } from "../services/zkong/client";
import { config } from "../config/env";

const TEST_BARCODE = "TESTPROMO001";
const STORE_ID = "1787791370298"; // Sugandha Puja (from storeList)
const MERCHANT_ID = config.zkong.merchantId;
const AGENCY_ID = config.zkong.agencyId;

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function getTestItem(): Promise<any> {
  const res: any = await zkongClient.post("/zk/erp/item/list?page=1&size=10", {
    storeId: Number(STORE_ID),
    attrCategory: "default",
    attrName: "default",
    pcBarCode: TEST_BARCODE,
  });
  const list: any[] = res.data?.data?.list ?? [];
  let found = list.find((x: any) => x.barCode === TEST_BARCODE) ?? null;
  if (!found) {
    // fallback: try without store filter, search all
    const res2: any = await zkongClient.post("/zk/erp/item/list?page=1&size=50", {
      attrCategory: "default",
      attrName: "default",
    });
    const list2: any[] = res2.data?.data?.list ?? [];
    found = list2.find((x: any) => x.barCode === TEST_BARCODE) ?? null;
  }
  return found;
}

async function fetchViaGetByBarcode(): Promise<any> {
  try {
    const res: any = await zkongClient.post("/zk/item/getItemByBarCodeAndExternalStoreId", {
      itemBarCode: TEST_BARCODE,
    });
    return res.data?.data ?? null;
  } catch {
    return null;
  }
}

async function ensureTestProduct() {
  console.log(`[test] ensuring TEST_BARCODE=${TEST_BARCODE} exists...`);
  // First clean any existing promo artifacts and ensure originalPrice is set for Jasmine Discount rule
  const payload = {
    merchantId: MERCHANT_ID,
    agencyId: AGENCY_ID,
    storeId: STORE_ID,
    unitName: 1,
    repricingFullUpdate: 1,
    itemList: [
      {
        barCode: TEST_BARCODE,
        itemTitle: "Test Promo Item",
        price: "1000",
        originalPrice: "1200",
        attrCategory: "default",
        attrName: "default",
        productCode: "TESTPROMO001",
        productSku: "TESTPROMO001",
        proStartTime: "",
        proEndTime: "",
      },
    ],
  };
  const res = await zkongClient.post("/zk/item/batchImportItem", payload);
  console.log(`[test] batchImportItem base: ${JSON.stringify(res.data).slice(0, 500)}`);
  // Verify immediately via direct lookup
  const viaList = await getTestItem();
  console.log(`[verify base] via erp/item/list:`, viaList ? `price=${viaList.price} originalPrice=${viaList.originalPrice}` : "not found");
}

async function pollPrice(label: string): Promise<any> {
  await sleep(3000); // give Zkong a moment to apply
  const item = await getTestItem();
  const viaGet = await fetchViaGetByBarcode();
  console.log(`[poll ${label}] erp/item/list:`, item ? `barCode=${item.barCode} price=${item.price} originalPrice=${item.originalPrice} proStartTime=${item.proStartTime} proEndTime=${item.proEndTime} repricingList=${JSON.stringify(item.repricingList)?.slice(0, 400)} updateTime=${item.updateTime}` : "not found");
  if (viaGet) {
    console.log(`[poll ${label}] getItemByBarCode: price=${viaGet.price} proStartTime=${viaGet.proStartTime}`);
  }
  return item;
}

async function testRepricingList() {
  console.log("\n=== TEST 1: repricingList ===");
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const payload = {
    merchantId: MERCHANT_ID,
    agencyId: AGENCY_ID,
    storeId: STORE_ID,
    unitName: 1,
    repricingFullUpdate: 1,
    itemList: [
      {
        barCode: TEST_BARCODE,
        itemTitle: "Test Promo Item",
        price: "1000",
        originalPrice: "1200",
        attrCategory: "default",
        attrName: "default",
        repricingList: [
          {
            repricingType: 1,
            auditTime: new Date().toISOString().slice(0, 19).replace("T", " "),
            repricingDateStart: today,
            repricingDateEnd: tomorrow,
            repricingTimeStart: "00:00",
            repricingTimeEnd: "23:59",
            price: "500",
            originalPrice: "1200",
          },
        ],
      },
    ],
  };
  const res = await zkongClient.post("/zk/item/batchImportItem", payload);
  console.log(`[test1] repricingList import: ${JSON.stringify(res.data).slice(0, 800)}`);
  await pollPrice("after repricingList");
}

async function testProStartTime() {
  console.log("\n=== TEST 2: proStartTime/proEndTime ===");
  const now = new Date();
  const start = new Date(now.getTime() - 60 * 60 * 1000).toISOString().slice(0, 19).replace("T", " ");
  const end = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString().slice(0, 19).replace("T", " ");
  const payload = {
    merchantId: MERCHANT_ID,
    agencyId: AGENCY_ID,
    storeId: STORE_ID,
    unitName: 1,
    itemList: [
      {
        barCode: TEST_BARCODE,
        itemTitle: "Test Promo Item",
        price: "1000",
        attrCategory: "default",
        attrName: "default",
        proStartTime: start,
        proEndTime: end,
        promotionText: "promo via proStartTime",
      },
    ],
  };
  const res = await zkongClient.post("/zk/item/batchImportItem", payload);
  console.log(`[test2] proStartTime import: ${JSON.stringify(res.data).slice(0, 500)}`);
  await pollPrice("after proStartTime");
}

async function testActivityStrategy(): Promise<number | null> {
  console.log("\n=== TEST 3: Activity Strategy ===");
  // Need itemId for strategy: fetch from erp/item/list
  const item = await getTestItem();
  if (!item?.id) {
    console.log("[test3] no item id found, skipping strategy test");
    return null;
  }
  const itemId = Number(item.id);
  console.log(`[test3] using itemId=${itemId} for strategy`);
  const now = Date.now();
  const startDate = now - 60 * 60 * 1000;
  const endDate = now + 24 * 60 * 60 * 1000;
  const payload = {
    storeId: Number(STORE_ID),
    name: `EMPIRICAL_TEST_${Date.now()}`,
    startDate,
    endDate,
    templateAttrCategory: "default",
    templateAttr: "default",
    triggerType: 1,
    periodType: 0,
    periodValue: [],
    periodTimes: ["00:00:00", "23:59:59"],
    selectFieldNameNum: [],
    itemActions: [
      {
        itemId,
        fieldValues: {
          price: "500",
        },
      },
    ],
  };
  const res: any = await zkongClient.post("/zk/strategy/create", payload);
  console.log(`[test3] strategy create: ${JSON.stringify(res.data).slice(0, 800)}`);
  const strategyId = res.data?.data as number | null;
  await pollPrice("after strategy create");
  return strategyId;
}

async function cleanup(strategyId: number | null) {
  console.log("\n=== CLEANUP ===");
  if (strategyId) {
    try {
      const res = await zkongClient.delete(`/zk/strategy/delete/${strategyId}`);
      console.log(`[cleanup] delete strategy ${strategyId}: ${JSON.stringify(res.data).slice(0, 300)}`);
    } catch (e: any) {
      console.log(`[cleanup] delete strategy failed: ${e.message} ${JSON.stringify(e.response?.data ?? "").slice(0, 300)}`);
    }
  }
  // Reset test product to base price without promo fields
  try {
    const payload = {
      merchantId: MERCHANT_ID,
      agencyId: AGENCY_ID,
      storeId: STORE_ID,
      unitName: 1,
      repricingFullUpdate: 1,
      itemList: [
        {
          barCode: TEST_BARCODE,
          itemTitle: "Test Promo Item",
          price: "1000",
          attrCategory: "default",
          attrName: "default",
          proStartTime: "",
          proEndTime: "",
          promotionText: "",
        },
      ],
    };
    const res = await zkongClient.post("/zk/item/batchImportItem", payload);
    console.log(`[cleanup] reset base product: ${JSON.stringify(res.data).slice(0, 300)}`);
  } catch (e: any) {
    console.log(`[cleanup] reset failed: ${e.message}`);
  }
}

async function main() {
  await getZkongToken();
  console.log(`[test] merchant=${MERCHANT_ID} agency=${AGENCY_ID} store=${STORE_ID}`);
  await ensureTestProduct();
  await pollPrice("baseline");
  await testRepricingList();
  await testProStartTime();
  const sid = await testActivityStrategy();
  await pollPrice("final");
  await cleanup(sid);
  console.log("\n=== DONE: check poll logs above to see which mechanism changed the polled price ===");
}

main().catch((e) => {
  console.error("fatal", e);
  if ((e as any).response?.data) console.error(JSON.stringify((e as any).response.data).slice(0, 1000));
  process.exit(1);
});
