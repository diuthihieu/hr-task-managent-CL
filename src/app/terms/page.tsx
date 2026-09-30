import type { Metadata } from "next";
import { getServerT } from "@/lib/prefs";
import { LegalPage, supportEmail } from "@/components/legal/legal-page";

export const metadata: Metadata = { title: "Terms of Service" };

export default async function TermsPage() {
  const { locale } = await getServerT();
  const email = supportEmail();
  if (locale === "vi")
    return (
      <LegalPage
        title="Điều khoản sử dụng"
        updated="Cập nhật: 28/09/2026"
        backLabel="Về trang chủ"
        intro="Khi tạo tài khoản hoặc sử dụng woli, bạn đồng ý với các điều khoản dưới đây."
        sections={[
          { title: "Tài khoản", body: ["Bạn chịu trách nhiệm giữ bí mật thông tin đăng nhập và mọi hoạt động diễn ra trong tài khoản của mình. Thông tin đăng ký phải chính xác."] },
          { title: "Sử dụng hợp lệ", body: ["Chỉ dùng woli cho mục đích công việc hợp pháp. Không tải lên mã độc, nội dung vi phạm pháp luật hoặc quyền của người khác, và không tìm cách truy cập dữ liệu ngoài quyền được cấp."] },
          { title: "Nội dung của bạn", body: ["Bạn và tổ chức của bạn giữ quyền đối với nội dung tạo trong workspace. Chúng tôi chỉ xử lý nội dung đó để cung cấp dịch vụ, như mô tả trong Chính sách quyền riêng tư."] },
          { title: "Tính năng AI", body: ["Kết quả do AI tạo có thể chưa chính xác. Hãy kiểm tra trước khi dùng cho quyết định quan trọng."] },
          { title: "Dịch vụ", body: ["Dịch vụ được cung cấp theo hiện trạng. Chúng tôi có thể cập nhật, thay đổi hoặc tạm ngừng tính năng, và cố gắng thông báo trước với thay đổi lớn."] },
          { title: "Chấm dứt", body: ["Bạn có thể ngừng sử dụng bất kỳ lúc nào. Tài khoản vi phạm điều khoản có thể bị khoá."] },
          { title: "Liên hệ", body: [email ? `Mọi câu hỏi về điều khoản: ${email}.` : "Mọi câu hỏi về điều khoản, vui lòng liên hệ quản trị viên của workspace."] },
        ]}
      />
    );
  return (
    <LegalPage
      title="Terms of Service"
      updated="Last updated: 28 September 2026"
      backLabel="Back to home"
      intro="By creating an account or using woli you agree to these terms."
      sections={[
        { title: "Accounts", body: ["You are responsible for keeping your sign-in details secret and for activity in your account. Registration details must be accurate."] },
        { title: "Acceptable use", body: ["Use woli only for lawful work purposes. Do not upload malware or content that breaks the law or others' rights, and do not try to access data beyond the permissions you were given."] },
        { title: "Your content", body: ["You and your organization keep the rights to content created in your workspace. We process it only to provide the service, as described in the Privacy Policy."] },
        { title: "AI features", body: ["AI-generated output can be inaccurate. Review it before relying on it for important decisions."] },
        { title: "The service", body: ["The service is provided as is. We may update, change or pause features, and aim to give notice of major changes."] },
        { title: "Termination", body: ["You can stop using the service at any time. Accounts that break these terms may be suspended."] },
        { title: "Contact", body: [email ? `Questions about these terms: ${email}.` : "For questions about these terms, contact your workspace administrator."] },
      ]}
    />
  );
}
