export default function PaymentFail() {
  return (
    <main
      className="empty"
      style={{ minHeight: "100dvh", justifyContent: "center" }}
    >
      <h1>결제를 완료하지 못했어요.</h1>
      <p>대화와 입력한 메시지는 그대로 있어요.</p>
      <a className="primary" href="/">
        이야기로 돌아가기
      </a>
    </main>
  );
}
