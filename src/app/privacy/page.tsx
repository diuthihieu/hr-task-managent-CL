import type { Metadata } from "next";
import { getServerT } from "@/lib/prefs";
import { LegalPage, supportEmail } from "@/components/legal/legal-page";

export const metadata: Metadata = { title: "Privacy Policy" };

export default async function PrivacyPage() {
  const { locale } = await getServerT();
  const email = supportEmail();
  const contact = email ? (locale === "vi" ? `Liên hệ: ${email}.` : `Contact: ${email}.`) : "";
  if (locale === "vi")
    return (
      <LegalPage
        title="Chính sách quyền riêng tư"
        updated="Cập nhật: 28/09/2026"
        backLabel="Về trang chủ"
        intro="woli là ứng dụng quản lý công việc cho nhóm (task, OKR, wiki, báo cáo). Trang này giải thích dữ liệu nào được thu thập, dùng vào việc gì và bạn có quyền gì."
        sections={[
          { title: "Dữ liệu chúng tôi thu thập", body: ["Thông tin tài khoản: họ tên, email, mật khẩu (chỉ lưu dạng mã hoá một chiều), ảnh đại diện và các tuỳ chọn giao diện.", "Khi đăng nhập bằng Google: chúng tôi chỉ nhận tên, email và mã định danh tài khoản Google (phạm vi openid, email, profile). Chúng tôi không truy cập Gmail, Drive, lịch hay dữ liệu Google nào khác.", "Nội dung bạn và đồng nghiệp tạo trong workspace: task, bình luận, file đính kèm, OKR, trang wiki, tài liệu tri thức, lịch sử hoạt động và thông báo."] },
          { title: "Mục đích sử dụng", body: ["Cung cấp và vận hành ứng dụng: đăng nhập, phân quyền, hiển thị và đồng bộ dữ liệu giữa web và ứng dụng máy tính.", "Gửi thông báo trong ứng dụng (được giao việc, được tag, sắp đến hạn...).", "Bảo mật: nhật ký hoạt động, phát hiện và ngăn chặn truy cập trái phép.", "Chúng tôi không bán dữ liệu và không dùng dữ liệu của bạn cho quảng cáo."] },
          { title: "Tính năng AI", body: ["Khi bạn dùng tính năng AI, nội dung liên quan mà bạn được phép xem sẽ được gửi tới Google Gemini API để tạo câu trả lời. AI chỉ nhận dữ liệu trong phạm vi quyền của bạn.", "Câu hỏi và câu trả lời trong Trợ lý AI được lưu trong workspace để bạn xem lại; bạn có thể xoá các cuộc hội thoại này."] },
          { title: "Nơi lưu trữ và bên xử lý", body: ["Dữ liệu được lưu trong cơ sở dữ liệu PostgreSQL và file được lưu trên dịch vụ lưu trữ đối tượng của nhà cung cấp hạ tầng (Vercel). Kết nối luôn được mã hoá (HTTPS).", "Các bên xử lý dữ liệu thay mặt chúng tôi: nhà cung cấp hosting và lưu trữ, Google (đăng nhập Google, Gemini API)."] },
          { title: "Chia sẻ trong workspace", body: ["Dữ liệu trong một workspace hiển thị cho thành viên theo vai trò (owner, admin, editor, contributor, viewer) và quyền riêng của từng dự án, wiki. Chủ workspace và quản trị viên quyết định ai được tham gia."] },
          { title: "Thời gian lưu và xoá dữ liệu", body: ["Dữ liệu được lưu khi tài khoản hoặc workspace còn hoạt động. Mục bị xoá được chuyển vào trạng thái đã xoá và có thể được xoá hẳn sau đó.", "Bạn có thể yêu cầu xem, sửa, xuất hoặc xoá dữ liệu cá nhân và tài khoản của mình. " + contact] },
          { title: "Thay đổi chính sách", body: ["Khi chính sách thay đổi, chúng tôi cập nhật ngày ở đầu trang này."] },
        ]}
      />
    );
  return (
    <LegalPage
      title="Privacy Policy"
      updated="Last updated: 28 September 2026"
      backLabel="Back to home"
      intro="woli is a work management app for teams (tasks, OKRs, wiki, reports). This page explains what data is collected, how it is used and your choices."
      sections={[
        { title: "Data we collect", body: ["Account data: name, email, password (stored only as a one-way hash), profile picture and interface preferences.", "With Google sign-in we receive only your name, email address and Google account identifier (scopes openid, email, profile). We do not access Gmail, Drive, Calendar or any other Google data.", "Content you and your teammates create in a workspace: tasks, comments, attachments, OKRs, wiki pages, knowledge documents, activity history and notifications."] },
        { title: "How we use it", body: ["To provide and operate the app: sign-in, permissions, showing and syncing your data across the web and desktop apps.", "To send in-app notifications (assignments, mentions, due dates...).", "For security: audit logs, detecting and preventing unauthorized access.", "We do not sell your data and do not use it for advertising."] },
        { title: "AI features", body: ["When you use an AI feature, the relevant content you are allowed to see is sent to the Google Gemini API to produce the answer. The AI only receives data within your permissions.", "AI Assistant questions and answers are stored in the workspace so you can revisit them; you can delete these conversations."] },
        { title: "Storage and processors", body: ["Data is stored in a PostgreSQL database and files in the hosting provider's object storage (Vercel). Connections are always encrypted (HTTPS).", "Processors acting on our behalf: the hosting and storage provider, and Google (Google sign-in, Gemini API)."] },
        { title: "Sharing inside a workspace", body: ["Workspace data is visible to members according to their role (owner, admin, editor, contributor, viewer) and to per-project and per-wiki access. Workspace owners and admins decide who joins."] },
        { title: "Retention and deletion", body: ["Data is kept while the account or workspace is active. Deleted items are marked as deleted and may be permanently removed later.", "You can ask to access, correct, export or delete your personal data and account. " + contact] },
        { title: "Changes", body: ["When this policy changes we update the date at the top of this page."] },
      ]}
    />
  );
}
