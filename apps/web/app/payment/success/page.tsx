"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import BrandIcon from "@/components/BrandIcon";
export default function PaymentSuccess() {
  const [message, setMessage] = useState("결제 승인을 확인하고 있어요."),
    [failed, setFailed] = useState(false);
  async function confirm() {
    setFailed(false);
    try {
      const q = new URLSearchParams(location.search);
      await api("/v1/payments/confirm", {
        method: "POST",
        body: JSON.stringify({
          order_id: q.get("orderId"),
          payment_key: q.get("paymentKey"),
          amount: Number(q.get("amount")),
        }),
      });
      setMessage("빛이 충전되었어요. 하던 이야기를 이어가세요.");
    } catch (e) {
      setMessage((e as Error).message);
      setFailed(true);
    }
  }
  useEffect(() => {
    void confirm();
  }, []);
  return (
    <main
      className="empty"
      style={{ minHeight: "100dvh", justifyContent: "center" }}
    >
      <BrandIcon size={56} />
      <h1>이야기는 계속됩니다</h1>
      <p role="status">{message}</p>
      {failed && (
        <button className="primary" onClick={confirm}>
          같은 주문 다시 확인
        </button>
      )}
      <a className="primary" href="/">
        대화로 돌아가기
      </a>
    </main>
  );
}
