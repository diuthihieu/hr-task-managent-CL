/**
 * The in-app Help center: how to use every feature, grouped in tabs that follow
 * the main menu. Plain data (no React), bilingual as [English, Vietnamese], so
 * it can be searched, unit-tested and reused by the docs.
 * `path` (optional) is a link inside the workspace, e.g. "/my-work".
 */

export type Bi = readonly [en: string, vi: string];

export interface HelpTopic {
  id: string;
  title: Bi;
  body: Bi;
  steps?: Bi[];
  tips?: Bi[];
}

export interface HelpTab {
  id: string;
  icon: HelpIcon;
  title: Bi;
  intro: Bi;
  path?: string;
  topics: HelpTopic[];
}

export type HelpIcon =
  | "rocket"
  | "home"
  | "list"
  | "inbox"
  | "sparkles"
  | "bot"
  | "brain"
  | "chart"
  | "target"
  | "award"
  | "book"
  | "folder"
  | "table"
  | "file"
  | "sliders"
  | "settings"
  | "keyboard"
  | "life";

export const HELP_TABS: HelpTab[] = [
  {
    id: "start",
    icon: "rocket",
    title: ["Getting started", "Bắt đầu"],
    intro: ["Create your account, sign in and enter your team's workspace.", "Tạo tài khoản, đăng nhập và vào workspace của nhóm."],
    topics: [
      {
        id: "register",
        title: ["Create an account", "Đăng ký tài khoản"],
        body: ["Everyone has their own account, registered with a work email.", "Mỗi người dùng một tài khoản riêng, đăng ký bằng email công việc."],
        steps: [
          ["Open the woli address your company gave you and choose Get started.", "Mở địa chỉ woli công ty cung cấp, bấm nút bắt đầu."],
          ["Pick the Register tab, enter your name, work email and a password (twice).", "Chọn thẻ Đăng ký, nhập họ tên, email công việc và mật khẩu (nhập lại để xác nhận)."],
          ["Press Create account, then open the verification email.", "Bấm Tạo tài khoản, sau đó mở email xác minh."],
        ],
        tips: [["Register with the email you were invited with to join your team's workspace straight away.", "Dùng đúng email được mời để vào ngay workspace của nhóm."]],
      },
      {
        id: "signin",
        title: ["Sign in and forgotten password", "Đăng nhập và quên mật khẩu"],
        body: ["Sign in with email and password, or with Google / Microsoft when your admin turned them on.", "Đăng nhập bằng email/mật khẩu, hoặc tài khoản Google / Microsoft nếu quản trị đã bật."],
        steps: [
          ["Enter your email and password and press Sign in.", "Nhập email, mật khẩu rồi bấm Đăng nhập."],
          ["Forgot it? Press Forgot password, enter your email and open the reset link (valid 1 hour, single use).", "Quên mật khẩu? Bấm Quên mật khẩu, nhập email và mở link đặt lại (hiệu lực 1 giờ, dùng một lần)."],
        ],
        tips: [
          ["A session expires after 12 hours. Changing your password signs out your other devices.", "Phiên đăng nhập hết hạn sau 12 giờ. Đổi mật khẩu sẽ đăng xuất các thiết bị khác."],
          ["No email? Look in the Spam folder.", "Không thấy thư? Kiểm tra mục Spam."],
        ],
      },
      {
        id: "workspace",
        title: ["Choose or create a workspace", "Chọn hoặc tạo workspace"],
        body: ["A workspace is the space of one team or department: its projects, members, OKRs, wikis and dashboards. One person can belong to several workspaces.", "Workspace là không gian làm việc của một nhóm/phòng ban: dự án, thành viên, OKR, wiki, dashboard. Một người có thể ở nhiều workspace."],
        steps: [
          ["After signing in, click a workspace card to enter it.", "Sau khi đăng nhập, bấm vào thẻ workspace để vào làm việc."],
          ["Or create a new workspace: you become its Owner.", "Hoặc tạo workspace mới: bạn trở thành Chủ sở hữu."],
          ["Invitations appear at the top of that page: press Accept to join.", "Lời mời hiện ở đầu trang: bấm Đồng ý để tham gia."],
        ],
        tips: [["Switch workspace any time from the workspace name at the top of the sidebar.", "Đổi workspace bất cứ lúc nào từ tên workspace ở đầu thanh bên."]],
      },
      {
        id: "layout",
        title: ["Find your way around", "Làm quen giao diện"],
        body: ["The left menu holds Home, My Work, Action center, Workspace Intelligence, Agent Work, Second Brain, Reports & dashboards, OKRs, Recognition, Wiki, your projects, Help and Settings. The top bar has search (Ctrl K), notifications and your profile menu.", "Menu bên trái gồm Trang chủ, Việc của tôi, Trung tâm xử lý, Workspace Intelligence, Agent Work, Second Brain, Báo cáo & dashboard, OKRs, Vinh danh, Wiki, các dự án, Trợ giúp và Cài đặt. Thanh trên cùng có tìm kiếm (Ctrl K), thông báo và menu cá nhân."],
        tips: [
          ["Collapse the sidebar with the button at its bottom to get more room.", "Thu gọn thanh bên bằng nút ở cuối thanh để có thêm chỗ."],
          ["On phones the menu opens from the ☰ button.", "Trên điện thoại, mở menu bằng nút ☰."],
        ],
      },
    ],
  },
  {
    id: "home",
    icon: "home",
    title: ["Home", "Trang chủ"],
    intro: ["Your daily command center: what needs you today, on one screen.", "Bảng điều khiển trong ngày: mọi việc cần bạn hôm nay trên một màn hình."],
    path: "",
    topics: [
      {
        id: "today",
        title: ["Today at a glance", "Tổng quan hôm nay"],
        body: ["Home shows My day, Needs attention (overdue, due soon, blocked, unplanned), Waiting for others and Completed, plus the day's numbers.", "Trang chủ hiển thị Việc hôm nay, Cần chú ý (quá hạn, sắp hạn, bị chặn, chưa lên lịch), Đang chờ người khác và Đã xong, cùng số liệu trong ngày."],
        steps: [
          ["Click a number (overdue, today…) to open the matching task list.", "Bấm vào một con số (quá hạn, hôm nay…) để mở danh sách task tương ứng."],
          ["Tick a task to complete it, or open it to see the details.", "Tick để hoàn thành task, hoặc mở task để xem chi tiết."],
        ],
      },
      {
        id: "brief",
        title: ["AI daily brief", "Tóm tắt ngày bằng AI"],
        body: ["The AI brief summarizes your day from the tasks you can see. Use Plan my day or Review risks for a suggested plan.", "Bản tóm tắt AI tổng hợp ngày của bạn từ các task bạn được xem. Dùng Lên kế hoạch ngày hoặc Rà soát rủi ro để nhận gợi ý."],
        tips: [["AI only reads data you are allowed to see, and only when a workspace admin has turned AI on.", "AI chỉ đọc dữ liệu bạn được xem, và chỉ chạy khi quản trị workspace đã bật AI."]],
      },
      {
        id: "customize",
        title: ["Customize Home", "Tuỳ chỉnh trang chủ"],
        body: ["Arrange Home your way with widgets and layouts.", "Sắp xếp trang chủ theo ý bạn bằng widget và bố cục."],
        steps: [
          ["Press Customize Home.", "Bấm Tuỳ chỉnh Home."],
          ["Pick a suggested layout, drag widgets in, and set each to S / M / L / XL.", "Chọn bố cục gợi ý, kéo widget vào trang, đổi cỡ S / M / L / XL."],
          ["Press Save. You can also save it as a template.", "Bấm Lưu. Có thể lưu thành template."],
        ],
        tips: [["Templates can be private, shared with chosen people or public in the workspace.", "Template có thể riêng tư, chia sẻ cho người chọn hoặc công khai trong workspace."]],
      },
    ],
  },
  {
    id: "my-work",
    icon: "list",
    title: ["My Work", "Việc của tôi"],
    intro: ["All your tasks across every project, and a place to capture ideas before they become tasks.", "Mọi việc của bạn ở mọi dự án, và nơi ghi nhanh ý tưởng trước khi thành task."],
    path: "/my-work",
    topics: [
      {
        id: "capture",
        title: ["Put all things on (quick capture)", "Put all things on (ghi nhanh ý tưởng)"],
        body: ["Write an idea down before it is a task: pick its project, category, duration and planned date.", "Ghi lại ý tưởng trước khi thành task: chọn dự án, category, thời lượng và ngày dự kiến."],
        steps: [
          ["Type the idea in the capture box and press Enter.", "Gõ ý tưởng vào ô ghi nhanh rồi nhấn Enter."],
          ["Drag its dot between the rings Today → Week → Month → Quarter → Later to plan it.", "Kéo chấm ý tưởng giữa các vòng Hôm nay → Tuần → Tháng → Quý → Sau này để lên lịch."],
          ["Click a dot and choose Convert to task when you are ready.", "Bấm vào chấm và chọn Chuyển thành task khi sẵn sàng."],
        ],
        tips: [["Your ideas are private. The AI reads your own ideas to answer \"what haven't I planned yet?\".", "Ý tưởng là của riêng bạn. AI đọc ý tưởng của chính bạn để trả lời \"tôi còn việc gì chưa lên kế hoạch?\"."]],
      },
      {
        id: "lists",
        title: ["My tasks, OKRs and key results", "Task, OKR và key result của tôi"],
        body: ["Lists of tasks assigned to you, your objectives and key results, an Eisenhower matrix and what is due soon.", "Danh sách task được giao, mục tiêu và key result của bạn, ma trận Eisenhower và việc sắp đến hạn."],
      },
    ],
  },
  {
    id: "inbox",
    icon: "inbox",
    title: ["Action center & notifications", "Trung tâm xử lý & thông báo"],
    intro: ["Everything waiting for you in one list, plus the notification bell.", "Mọi việc đang chờ bạn trong một danh sách, cùng chuông thông báo."],
    path: "/inbox",
    topics: [
      {
        id: "action-center",
        title: ["Action center", "Trung tâm xử lý"],
        body: ["Collects assignments, @mentions, due dates, approvals, invitations, reward requests and AI suggestions.", "Gom việc được giao, @nhắc tên, hạn chót, phê duyệt, lời mời, yêu cầu đổi quà và gợi ý AI."],
        steps: [
          ["Open an item to act on it (approve, reply, open the task…).", "Mở một mục để xử lý (duyệt, trả lời, mở task…)."],
          ["Snooze an item to bring it back at the time you choose.", "Tạm hoãn một mục để nó quay lại đúng lúc bạn chọn."],
        ],
      },
      {
        id: "bell",
        title: ["Notifications", "Thông báo"],
        body: ["The bell in the top bar shows new assignments, mentions, due-date changes, approvals, kudos and AI suggestions.", "Chuông trên cùng báo việc được giao, @nhắc tên, đổi hạn, phê duyệt, lời khen và gợi ý AI."],
        steps: [["Click a notification to open it; use Mark all as read to clear the list.", "Bấm thông báo để mở; dùng Đánh dấu đã đọc tất cả để dọn danh sách."]],
        tips: [["Turn on desktop pop-ups, choose a sound and the notification types in Settings → Notifications.", "Bật thông báo desktop, chọn âm thanh và loại thông báo trong Cài đặt → Thông báo."]],
      },
    ],
  },
  {
    id: "projects",
    icon: "folder",
    title: ["Projects & views", "Dự án & các view"],
    intro: ["Each project holds tasks you can see in eight kinds of views. Every view shares the same data.", "Mỗi dự án chứa task, xem được bằng 8 loại view. Mọi view dùng chung một dữ liệu."],
    topics: [
      {
        id: "new-project",
        title: ["Create a project", "Tạo dự án"],
        body: ["Press + next to Projects in the sidebar, give it a name and optionally an icon. You become the project owner.", "Bấm + cạnh mục Dự án ở thanh bên, đặt tên và (tuỳ chọn) icon. Bạn trở thành chủ dự án."],
        tips: [["Only owners, admins and editors can own a project.", "Chỉ Chủ sở hữu, Quản trị và Biên tập mới làm chủ dự án được."]],
      },
      {
        id: "grid",
        title: ["Table (Grid) view", "View Bảng (Grid)"],
        body: ["Work like a spreadsheet: one row per task, edit in the cell, paste many cells at once, select several rows.", "Làm việc như bảng tính: mỗi dòng một task, sửa trực tiếp trong ô, dán nhiều ô một lúc, chọn nhiều dòng."],
        steps: [
          ["Click a cell to edit it; press Esc to cancel.", "Bấm vào ô để sửa; nhấn Esc để huỷ."],
          ["Drag across cells (or Shift+click) to select a range; click the row handles (Shift+click for more) to select whole rows. Ctrl C / Ctrl V copy and paste ranges and rows - also between projects and with Excel; Ctrl D fills the first value down. Right-click for Paste as new rows.", "Kéo chuột qua các ô (hoặc Shift+click) để chọn vùng; bấm ô đầu dòng (Shift+click để chọn thêm) để chọn cả dòng. Ctrl C / Ctrl V sao chép và dán vùng ô hoặc dòng - kể cả giữa các project và với Excel; Ctrl D điền giá trị đầu tiên xuống các dòng bên dưới. Chuột phải để chọn Dán thành dòng mới."],
          ["Drag a column header to reorder it; drag its edge to resize.", "Kéo tiêu đề cột để đổi vị trí; kéo mép cột để đổi độ rộng."],
          ["Press + Add task at the bottom to add a row.", "Bấm + Thêm task ở cuối bảng để thêm dòng."],
        ],
        tips: [["Freeze columns from the column menu: frozen columns and group names stay visible when you scroll sideways.", "Cố định cột từ menu của cột: cột cố định và tên nhóm vẫn hiện khi kéo ngang."]],
      },
      {
        id: "toolbar",
        title: ["Toolbar: filter, sort, group, fields, colors", "Thanh công cụ: lọc, sắp xếp, nhóm, trường, tô màu"],
        body: ["Settings in the toolbar are saved for the current view only.", "Thiết lập trên thanh công cụ được lưu riêng cho view hiện tại."],
        steps: [
          ["Filter: add conditions (field, operator, value), combined with and / or.", "Lọc: thêm điều kiện (trường, phép so sánh, giá trị), kết hợp và / hoặc."],
          ["Sort: by one or more fields.", "Sắp xếp: theo một hoặc nhiều trường."],
          ["Group: gather rows by status, assignee, category, priority…; each group folds and shows its count.", "Nhóm: gom dòng theo trạng thái, người phụ trách, category, ưu tiên…; mỗi nhóm thu gọn được và hiện số task."],
          ["Fields: show or hide columns.", "Trường: ẩn/hiện cột."],
          ["Colors: rules such as \"Due date passed → red background\".", "Tô màu: quy tắc như \"Hạn chót đã qua → nền đỏ\"."],
          ["Wrap text, Row height, Search this view.", "Xuống dòng, Chiều cao dòng, Tìm trong view."],
        ],
      },
      {
        id: "save-export",
        title: ["Save as view and export", "Lưu thành view và xuất file"],
        body: ["Keep a filter + sort as a new tab, or export tasks to CSV / Excel.", "Giữ bộ lọc + sắp xếp thành một tab mới, hoặc xuất task ra CSV / Excel."],
        steps: [
          ["Save as view: name it, e.g. \"My overdue tasks\".", "Lưu thành view: đặt tên, VD \"Việc quá hạn của tôi\"."],
          ["Export: choose CSV or XLSX, the filtered view / all / selected tasks, and visible or all fields.", "Xuất file: chọn CSV hoặc XLSX, view đang lọc / tất cả / task đã chọn, trường đang hiện hoặc tất cả."],
        ],
      },
      {
        id: "manage-views",
        title: ["Add and manage views", "Thêm và quản lý view"],
        body: ["Press + Add view and pick Table, Kanban, Calendar, Gallery, Form, Gantt, Eisenhower or Dashboard. The … button on a view tab renames, duplicates, deletes it or makes it public / private.", "Bấm + Thêm view và chọn Bảng, Kanban, Lịch, Gallery, Biểu mẫu, Gantt, Eisenhower hoặc Bảng điều khiển. Nút … trên tab view để đổi tên, nhân bản, xoá, đặt công khai / riêng tư."],
        tips: [["Who may add or edit shared views is set per person in Project settings → Permissions.", "Ai được thêm hoặc sửa view chung do Cài đặt dự án → Phân quyền quyết định cho từng người."]],
      },
      {
        id: "kanban",
        title: ["Kanban view", "View Kanban"],
        body: ["Columns by status (or assignee, priority…). Drag a card to change its status or group; press + at the top of a column to add a task there.", "Cột theo trạng thái (hoặc người, ưu tiên…). Kéo thẻ để đổi trạng thái/nhóm; bấm + đầu cột để thêm task vào cột đó."],
        tips: [["Kanban settings choose the grouping field and the fields shown on cards.", "Cài đặt Kanban chọn trường nhóm và các trường hiện trên thẻ."]],
      },
      {
        id: "calendar",
        title: ["Calendar view", "View Lịch"],
        body: ["Tasks by start or due date in Month / Week / Day. Drag a task to another day to move its date.", "Task theo ngày bắt đầu hoặc hạn chót ở dạng Tháng / Tuần / Ngày. Kéo task sang ngày khác để đổi ngày."],
        tips: [["Pick which date field is used in Calendar settings.", "Chọn trường ngày dùng để hiển thị trong Cài đặt lịch."]],
      },
      {
        id: "gallery",
        title: ["Gallery view", "View Gallery"],
        body: ["Large cards with a cover image, good for candidate profiles or training materials. Hover a card for quick actions: Complete, Start, Plan, More.", "Thẻ lớn có ảnh bìa, hợp cho hồ sơ ứng viên hay tài liệu đào tạo. Rê chuột lên thẻ để có thao tác nhanh: Hoàn thành, Bắt đầu, Lên lịch, Thêm."],
        tips: [["Gallery settings: card size, cover, visible fields, fit content. Cards without a cover show no empty image area.", "Cài đặt Gallery: cỡ thẻ, ảnh bìa, trường hiển thị, vừa nội dung. Thẻ không có ảnh bìa sẽ không có vùng ảnh trống."]],
      },
      {
        id: "form",
        title: ["Form view", "View Biểu mẫu"],
        body: ["A form to collect requests: each submission creates a new task in the project.", "Biểu mẫu nhận yêu cầu: mỗi lần gửi tạo một task mới trong dự án."],
        steps: [
          ["Choose the fields on the form and which are required.", "Chọn các trường trên biểu mẫu và trường bắt buộc."],
          ["Turn on the public link to let people outside the workspace submit.", "Bật link công khai để người ngoài workspace gửi được."],
        ],
      },
      {
        id: "gantt",
        title: ["Gantt view", "View Gantt"],
        body: ["A timeline of tasks to spot overlaps. Drag a bar to move it, drag its edge to change the duration, double-click to open the task.", "Dòng thời gian của task để thấy việc chồng chéo. Kéo thanh để dời, kéo mép để đổi thời lượng, nhấp đúp để mở task."],
      },
      {
        id: "eisenhower",
        title: ["Eisenhower view", "View Eisenhower"],
        body: ["Four boxes by importance and urgency: do now, schedule, delegate, drop. Drag cards between boxes.", "Bốn ô theo mức quan trọng và khẩn cấp: làm ngay, lên lịch, giao việc, cân nhắc bỏ. Kéo thẻ giữa các ô."],
      },
      {
        id: "shared-actions",
        title: ["Actions in every view", "Thao tác dùng chung ở mọi view"],
        body: ["On every row or card: the side-panel button opens the task beside the view, the expand button opens it full page. Edits in any view update all views at once. Ask AI (bottom corner) answers about the project.", "Trên mọi dòng hoặc thẻ: nút panel mở task bên cạnh, nút mở rộng mở toàn trang. Sửa ở bất kỳ view nào, mọi view cập nhật ngay. Nút Hỏi AI (góc dưới) trả lời về dự án."],
      },
    ],
  },
  {
    id: "tasks",
    icon: "file",
    title: ["Task details", "Chi tiết task"],
    intro: ["Everything about one task: fields, description, comments, files, history, approvals and focus.", "Mọi thông tin của một task: trường, mô tả, bình luận, file, lịch sử, phê duyệt và focus."],
    topics: [
      {
        id: "panel-page",
        title: ["Side panel and full page", "Panel bên cạnh và trang đầy đủ"],
        body: ["The panel shows all fields and the Comments, Files and History tabs. Open as page gives room for long content, checklists and approvals.", "Panel hiện mọi trường và các tab Bình luận, File, Lịch sử. Mở thành trang để có chỗ cho nội dung dài, checklist và phê duyệt."],
        tips: [["The page shows the save status; Back returns to the list.", "Trang có trạng thái lưu; nút Quay lại về danh sách."]],
      },
      {
        id: "fields",
        title: ["Built-in fields", "Các trường có sẵn"],
        body: ["Name, description, status, assignees, report to, priority, category, start and due dates, estimate, actual time, progress, completed date, objective / key result and attachments. Owners can add custom columns.", "Tên, mô tả, trạng thái, người phụ trách, báo cáo cho, ưu tiên, category, ngày bắt đầu và hạn chót, ước tính, giờ thực tế, tiến độ, ngày hoàn thành, mục tiêu / key result và file đính kèm. Chủ dự án có thể thêm cột riêng."],
        tips: [
          ["Completed date fills in by itself when a task moves to a Done status, and can be edited.", "Ngày hoàn thành tự điền khi task chuyển sang trạng thái Done, và sửa được."],
          ["Report to: the people who get notified about status and updates.", "Báo cáo cho: những người nhận thông báo khi task đổi trạng thái hay cập nhật."],
        ],
      },
      {
        id: "done-check",
        title: ["Done check", "Kiểm tra khi hoàn thành"],
        body: ["When a task becomes Done and its actual time, start, due or completed date is missing, a pop-up asks you to fill them in or ignore.", "Khi task chuyển sang Done mà còn thiếu giờ thực tế, ngày bắt đầu, hạn chót hoặc ngày hoàn thành, popup sẽ hỏi bạn điền bổ sung hoặc bỏ qua."],
      },
      {
        id: "comments",
        title: ["Comments and @mentions", "Bình luận và @nhắc tên"],
        body: ["Discuss on the task. Type @ to mention a colleague (they get a notification). Comments support formatting, nested replies and reactions.", "Trao đổi ngay trên task. Gõ @ để nhắc đồng nghiệp (họ nhận thông báo). Bình luận có định dạng, trả lời lồng nhau và thả cảm xúc."],
        tips: [["The AI reads comments too when it summarizes or reports, and cites the task it took them from.", "AI cũng đọc bình luận khi tóm tắt hay báo cáo, và trích dẫn task nguồn."]],
      },
      {
        id: "files",
        title: ["Attachments", "File đính kèm"],
        body: ["Attach images and files; images, PDFs and Word / PowerPoint files preview inside the app, everything can be downloaded.", "Đính kèm ảnh và file; ảnh, PDF, Word / PowerPoint xem trước ngay trong app, mọi file đều tải xuống được."],
      },
      {
        id: "approval",
        title: ["Approvals", "Phê duyệt"],
        body: ["On the task page press Request approval and pick the approvers. They approve or reject from the Action center.", "Trên trang task bấm Gửi duyệt và chọn người duyệt. Họ duyệt hoặc từ chối ngay trong Trung tâm xử lý."],
      },
      {
        id: "focus",
        title: ["Focus mode", "Chế độ tập trung (Focus)"],
        body: ["Press Start focus on a task. A focus block lasts 25 minutes by default (you can change it); the time is added to the task's actual time when you stop.", "Bấm Bắt đầu tập trung trên task. Mỗi phiên mặc định 25 phút (có thể đổi); thời gian được cộng vào giờ thực tế khi dừng."],
        steps: [
          ["Pause / resume, switch to another task, complete the task or stop.", "Tạm dừng / tiếp tục, đổi sang task khác, hoàn thành task hoặc dừng."],
          ["Use the checklist and notes in the focus bar while you work.", "Dùng checklist và ghi chú trên thanh focus khi làm việc."],
        ],
        tips: [["You can keep several sessions: one runs, the others pause. The focus bar stays at the bottom of the screen.", "Có thể giữ nhiều phiên: một phiên chạy, các phiên khác tạm dừng. Thanh focus nằm ở đáy màn hình."]],
      },
      {
        id: "task-ai",
        title: ["AI on a task", "AI trên task"],
        body: ["AI actions on a task: summarize, find blockers, draft a message, break it into sub-tasks, write a retrospective. AI follows the answer style in your profile (e.g. always Vietnamese).", "Các thao tác AI trên task: tóm tắt, tìm vướng mắc, soạn tin nhắn, chia nhỏ thành task con, viết retrospective. AI làm theo cách trả lời trong hồ sơ của bạn (VD luôn trả lời tiếng Việt)."],
      },
    ],
  },
  {
    id: "project-settings",
    icon: "sliders",
    title: ["Project settings", "Cài đặt dự án"],
    intro: ["Categories, owner, permissions and moving data. Open it from the project's … menu → Project settings.", "Category, chủ dự án, phân quyền và chuyển dữ liệu. Mở từ menu … của dự án → Cài đặt dự án."],
    topics: [
      {
        id: "general",
        title: ["General and categories", "Thông tin chung và category"],
        body: ["Description, color, status, start / end dates. Categories belong to this project only and each can have a color; deleting one leaves its tasks uncategorized.", "Mô tả, màu, trạng thái, ngày bắt đầu / kết thúc. Category chỉ thuộc dự án này, mỗi category có màu riêng; xoá category thì task của nó không còn category."],
      },
      {
        id: "permissions",
        title: ["Permissions in this project", "Phân quyền trong dự án"],
        body: ["A table of members × rights: create tasks, edit own, edit all, delete, comment, add / edit columns, add views, edit shared views, manage objectives, project settings. The Visible column hides the project from chosen people.", "Bảng thành viên × quyền: tạo task, sửa task của mình, sửa mọi task, xoá, bình luận, thêm / sửa cột, thêm view, sửa view chung, quản lý mục tiêu, cài đặt dự án. Cột Hiển thị dùng để ẩn dự án với người được chọn."],
        steps: [
          ["Tick or untick rights for each member (templates fill a row in one click).", "Tick hoặc bỏ tick quyền cho từng thành viên (template điền nhanh cả dòng)."],
          ["Press Save. Nothing changes until you save.", "Bấm Lưu. Chưa lưu thì chưa có thay đổi."],
        ],
        tips: [
          ["Inside a project the project owner ranks above workspace owners and admins and can narrow or hide them.", "Trong một dự án, chủ dự án có quyền cao hơn chủ sở hữu và quản trị workspace, có thể thu hẹp quyền hoặc ẩn dự án với họ."],
          ["A person never gets more than their workspace role allows.", "Không ai có quyền vượt quá vai trò của họ trong workspace."],
        ],
      },
      {
        id: "handover",
        title: ["Hand over the project", "Chuyển giao dự án"],
        body: ["The project owner can hand the project to another member (editor or above). A second step confirms what changes.", "Chủ dự án có thể chuyển dự án cho thành viên khác (từ Biên tập trở lên). Bước thứ hai xác nhận những gì thay đổi."],
      },
      {
        id: "transfer",
        title: ["Move all data to another project", "Chuyển toàn bộ dữ liệu sang dự án khác"],
        body: ["Moves tasks (with comments, files, history, sub-tasks), categories, column values, optionally objectives, plus ideas and decisions into another project of the workspace. Existing data in the target is kept; columns and categories with the same name are reused, others are created.", "Chuyển task (kèm bình luận, file, lịch sử, task con), category, giá trị cột, mục tiêu (tuỳ chọn), ý tưởng và quyết định sang dự án khác cùng workspace. Dữ liệu sẵn có ở dự án đích được giữ nguyên; cột và category trùng tên được dùng lại, chưa có thì tạo mới."],
        steps: [
          ["Pick the target project and read the preview.", "Chọn dự án đích và xem bản xem trước."],
          ["Choose whether to move objectives and to archive the source, tick the confirmation and press Move.", "Chọn có chuyển mục tiêu và lưu trữ dự án nguồn không, tick xác nhận rồi bấm Chuyển."],
        ],
        tips: [["There is no undo. Try it on two small test projects first.", "Không có hoàn tác. Nên thử trên hai dự án nhỏ trước."]],
      },
    ],
  },
  {
    id: "reports",
    icon: "chart",
    title: ["Reports & dashboards", "Báo cáo & dashboard"],
    intro: ["Charts that update by themselves, AI narratives and AI-written PDF reports.", "Biểu đồ tự cập nhật, AI diễn giải và báo cáo PDF do AI soạn."],
    path: "/dashboards",
    topics: [
      {
        id: "project-dashboard",
        title: ["Project dashboard view", "View Bảng điều khiển của dự án"],
        body: ["A Dashboard view inside a project charts the tasks of that view. Drag a card by its title to move it, drag a corner to resize, click a chart segment to see the tasks behind it.", "View Bảng điều khiển trong dự án vẽ biểu đồ từ task của view. Kéo tiêu đề thẻ để di chuyển, kéo góc để đổi cỡ, bấm vào phần biểu đồ để xem các task tương ứng."],
      },
      {
        id: "widgets",
        title: ["Chart types", "Các loại biểu đồ"],
        body: ["Project dashboards: KPI card, bar / column, stacked, line / area, pie / donut, pivot and AI Narrative. Workspace dashboards add table, combo, scatter, radar, treemap, funnel and gauge.", "Dashboard dự án: KPI, cột / thanh, chồng, đường / vùng, tròn / donut, pivot và AI Narrative. Dashboard workspace có thêm bảng, combo, scatter, radar, treemap, phễu và gauge."],
      },
      {
        id: "workspace-dashboards",
        title: ["Workspace dashboards", "Dashboard của workspace"],
        body: ["Reports & dashboards combines data from several projects, in tabs. Slicers filter every widget; clicking a chart segment cross-filters the others.", "Báo cáo & dashboard lấy dữ liệu từ nhiều dự án, chia thành tab. Bộ lọc (slicer) áp dụng cho mọi widget; bấm phần biểu đồ để lọc chéo."],
      },
      {
        id: "ai-build",
        title: ["Build a dashboard with AI", "Tạo dashboard bằng AI"],
        body: ["Describe one chart or a whole layout (KPI row, columns…); AI builds up to 16 widgets. Choose add, replace or create a new dashboard.", "Mô tả một biểu đồ hoặc cả bố cục (hàng KPI, chia cột…); AI dựng tối đa 16 widget. Chọn thêm, thay thế hoặc tạo dashboard mới."],
      },
      {
        id: "narrative",
        title: ["AI Narrative", "AI Narrative"],
        body: ["A widget whose text is written by AI and rewritten when the data or filters change.", "Widget có đoạn diễn giải do AI viết, tự viết lại khi dữ liệu hoặc bộ lọc thay đổi."],
      },
      {
        id: "pdf",
        title: ["AI PDF report and report library", "Báo cáo PDF bằng AI và thư viện báo cáo"],
        body: ["AI first asks how the report should look (goal, charts, depth, file name), then writes it with the charts on the dashboard. Preview it, download the PDF or save it to your library.", "AI hỏi trước bạn muốn báo cáo thế nào (mục tiêu, biểu đồ, mức phân tích, tên file), rồi soạn báo cáo kèm biểu đồ đang có trên dashboard. Xem trước, tải PDF hoặc lưu vào thư viện."],
        tips: [
          ["The library is private: reopen, download again or delete your saved reports.", "Thư viện là của riêng bạn: mở lại, tải lại hoặc xoá báo cáo đã lưu."],
          ["Check key numbers before sending a report to management.", "Kiểm tra lại các số liệu quan trọng trước khi gửi lãnh đạo."],
        ],
      },
    ],
  },
  {
    id: "okrs",
    icon: "target",
    title: ["OKRs", "OKRs"],
    intro: ["Measurable objectives: Objective → Key result → Task, with progress computed for you.", "Mục tiêu đo được: Mục tiêu → Key result → Task, tiến độ tự tính."],
    path: "/okrs",
    topics: [
      {
        id: "objectives",
        title: ["All OKRs, My OKRs, OKR dashboard", "Tất cả OKR, OKR của tôi, OKR Dashboard"],
        body: ["All OKRs lists the workspace's objectives; filter by cycle (quarter / year) or a custom date range. My OKRs shows yours; the OKR dashboard charts progress and risk.", "Tất cả OKR liệt kê mục tiêu của workspace; lọc theo chu kỳ (quý / năm) hoặc khoảng ngày. My OKRs là của bạn; OKR Dashboard vẽ tiến độ và rủi ro."],
      },
      {
        id: "create",
        title: ["Create an objective and key results", "Tạo mục tiêu và key result"],
        body: ["Give the objective a clear name and a cycle, then add measurable key results.", "Đặt tên mục tiêu rõ ràng và chu kỳ, rồi thêm các key result đo được."],
        steps: [
          ["Press New objective, enter the name and cycle (Quarter / Year / Custom), Save.", "Bấm Mục tiêu mới, nhập tên và chu kỳ (Quý / Năm / Tuỳ chọn), Lưu."],
          ["Add key results with current / target value and unit, owner, confidence and deadline.", "Thêm key result với giá trị hiện tại / mục tiêu và đơn vị, người phụ trách, độ tự tin và hạn."],
          ["Link tasks to a key result (task field Objective) so progress updates by itself.", "Liên kết task với key result (trường Mục tiêu của task) để tiến độ tự cập nhật."],
        ],
        tips: [["Example KR: \"100% of new hires finish onboarding within 7 days\".", "Ví dụ KR: \"100% nhân viên mới hoàn thành onboarding trong 7 ngày\"."]],
      },
    ],
  },
  {
    id: "wiki",
    icon: "book",
    title: ["Wiki", "Wiki"],
    intro: ["Store processes, policies and guides; comment and ask AI right on the page.", "Lưu quy trình, chính sách, hướng dẫn; bình luận và hỏi AI ngay trên trang."],
    path: "/wiki",
    topics: [
      {
        id: "pages",
        title: ["Pages and links", "Trang và liên kết"],
        body: ["Write pages with a rich editor. Type [[ to link a page, task, objective or person; backlinks show who links here.", "Viết trang với trình soạn thảo đầy đủ. Gõ [[ để liên kết tới trang, task, mục tiêu hoặc người; mục liên kết ngược cho biết trang nào trỏ tới đây."],
        tips: [["Select text for quick actions: Ask AI, create a task or reminder, link a block, highlight, record a decision.", "Bôi đen chữ để có thao tác nhanh: Hỏi AI, tạo task hoặc nhắc việc, liên kết khối, tô sáng, ghi quyết định."]],
      },
      {
        id: "access",
        title: ["Icon and access", "Icon và phân quyền wiki"],
        body: ["Pick an icon and who can open the wiki, with roles Viewer, Editor and Manager (each role is described in the list). Workspace admins and the wiki's creator are always Managers.", "Chọn icon và ai được mở wiki, với vai trò Chỉ xem, Được chỉnh sửa và Quản lý (mỗi vai trò có mô tả trong danh sách). Quản trị workspace và người tạo wiki luôn là Quản lý."],
      },
      {
        id: "wiki-ai",
        title: ["Ask the wiki and knowledge files", "Hỏi wiki và tài liệu tham khảo"],
        body: ["Each wiki has an assistant that answers only from its pages and uploaded reference files, citing the source. Managers set its instructions or turn it off.", "Mỗi wiki có trợ lý chỉ trả lời từ các trang và tài liệu tham khảo đã tải lên, có ghi nguồn. Người quản lý đặt hướng dẫn cho trợ lý hoặc tắt nó."],
      },
    ],
  },
  {
    id: "brain",
    icon: "brain",
    title: ["Second Brain", "Second Brain"],
    intro: ["Your knowledge in one place: daily to yearly reviews, journal, decisions, questions with sources.", "Tri thức ở một nơi: tổng kết theo ngày đến năm, nhật ký, quyết định, hỏi đáp có nguồn."],
    path: "/brain",
    topics: [
      {
        id: "home",
        title: ["Second Brain Home", "Second Brain Home"],
        body: ["Switch Day / Week / Month / Year and move between periods. Day shows what needs attention and pages to review; longer periods show wins, decisions, new knowledge and open loops, with an AI summary.", "Chuyển Ngày / Tuần / Tháng / Năm và lùi / tiến kỳ. Ngày: việc cần chú ý và trang nên ôn. Kỳ dài hơn: thành quả, quyết định, tri thức mới, việc còn treo, kèm tổng kết AI."],
      },
      {
        id: "journal",
        title: ["Journal & decisions", "Nhật ký & quyết định"],
        body: ["A daily journal (with saved note history) and a decision log in one tab.", "Nhật ký hằng ngày (có lịch sử ghi chú) và sổ quyết định trong cùng một tab."],
        tips: [["Record each policy change as a decision with its reason, to look it up later.", "Ghi mỗi thay đổi chính sách thành một quyết định kèm lý do để tra cứu sau."]],
      },
      {
        id: "ask",
        title: ["Ask Second Brain", "Hỏi Second Brain"],
        body: ["Ask within a scope: everything, a project, a wiki, chosen sources or my notes. Answers cite [S1], [S2]… — click to open the source.", "Hỏi trong phạm vi bạn chọn: tất cả, dự án, wiki, nguồn chọn hoặc ghi chú của tôi. Câu trả lời trích dẫn [S1], [S2]… — bấm để mở nguồn."],
      },
      {
        id: "graph-health",
        title: ["Graph and knowledge health", "Đồ thị và sức khỏe tri thức"],
        body: ["The graph shows how pages, tasks and people link. Knowledge health finds outdated, duplicate or unsourced pages and broken links; AI checks for contradictions.", "Đồ thị cho thấy liên kết giữa trang, task và người. Sức khỏe tri thức tìm trang lỗi thời, trùng lặp, thiếu nguồn, link hỏng; AI kiểm tra mâu thuẫn."],
      },
    ],
  },
  {
    id: "ai",
    icon: "sparkles",
    title: ["Workspace Intelligence (AI)", "Workspace Intelligence (AI)"],
    intro: ["Ask questions and get reports from the data you are allowed to see.", "Hỏi đáp và lấy báo cáo từ dữ liệu bạn được xem."],
    path: "/ai",
    topics: [
      {
        id: "ask",
        title: ["Ask and report", "Hỏi và làm báo cáo"],
        body: ["Ask about projects, tasks, comments, OKRs and wikis. Attach images or files (up to 8,000 characters per question). Export an answer to PDF or turn it into a wiki page.", "Hỏi về dự án, task, bình luận, OKR và wiki. Đính kèm ảnh hoặc file (tối đa 8.000 ký tự mỗi câu). Xuất câu trả lời ra PDF hoặc chuyển thành trang wiki."],
      },
      {
        id: "citations",
        title: ["Sources in answers", "Nguồn trong câu trả lời"],
        body: ["Statements about a task carry a small ↗ link. Click it to open that task in a new tab and check the source.", "Nhận định về một task có kèm link ↗ nhỏ. Bấm vào để mở task đó trong tab mới và kiểm tra nguồn."],
        tips: [["The AI never invents a link: a source that is not in your data is dropped.", "AI không tự tạo link: nguồn không có trong dữ liệu của bạn sẽ bị bỏ."]],
      },
      {
        id: "intake",
        title: ["Create tasks by talking", "Tạo task bằng lời"],
        body: ["In a project press Ask AI and describe the work (what, due date, who). AI asks for what is missing and drafts the task; it is only created after you confirm.", "Trong dự án bấm Hỏi AI và mô tả việc (nội dung, hạn, người làm). AI hỏi lại phần thiếu và soạn bản nháp; task chỉ được tạo sau khi bạn bấm Xác nhận."],
      },
      {
        id: "limits",
        title: ["Limits and errors", "Giới hạn và lỗi"],
        body: ["Each person has a daily question quota. If Gemini is busy, the app retries on several models; wait a few minutes and press Try again. Test AI connection checks the link to Gemini.", "Mỗi người có hạn mức câu hỏi mỗi ngày. Khi Gemini quá tải, app tự thử lại trên nhiều model; đợi vài phút rồi bấm Thử lại. Nút Kiểm tra kết nối AI kiểm tra đường kết nối tới Gemini."],
      },
    ],
  },
  {
    id: "agent",
    icon: "bot",
    title: ["Agent Work", "Agent Work"],
    intro: ["Hand multi-step work to AI agents that follow skills.", "Giao việc nhiều bước cho agent AI làm theo skill."],
    path: "/agent-work",
    topics: [
      {
        id: "runs",
        title: ["Runs, skills and approvals", "Lượt chạy, skill và phê duyệt"],
        body: ["Start a run from a skill, follow its steps and outputs. Sensitive steps always wait for a person's approval.", "Chạy agent theo một skill, theo dõi các bước và kết quả. Bước nhạy cảm luôn chờ người phê duyệt."],
        tips: [["Share a skill as private, with chosen people or with the whole organization.", "Chia sẻ skill ở chế độ riêng tư, cho người cụ thể hoặc toàn tổ chức."]],
      },
    ],
  },
  {
    id: "recognition",
    icon: "award",
    title: ["Recognition", "Vinh danh"],
    intro: ["Send kudos, see the leaderboard and redeem points for rewards.", "Gửi lời khen, xem bảng vinh danh và đổi điểm lấy quà."],
    path: "/recognition",
    topics: [
      {
        id: "kudos",
        title: ["Send kudos", "Gửi lời khen"],
        body: ["Write a kudos letter with a card design and an editable greeting; AI can draft it from shared work history. The receiver gets a pop-up and can react.", "Viết thư khen với mẫu thiệp và lời chào sửa được; AI có thể soạn nháp từ lịch sử làm việc chung. Người nhận thấy popup và có thể thả cảm xúc."],
        tips: [["Kudos tied to a concrete task mean more.", "Lời khen gắn với task cụ thể sẽ có ý nghĩa hơn."]],
      },
      {
        id: "rewards",
        title: ["Leaderboard, points and rewards", "Bảng vinh danh, điểm và quà"],
        body: ["Points follow the rules set by managers. Redeem points for items in the rewards catalog; managers approve requests from the Action center and you see your redemption history.", "Điểm tính theo quy tắc do người quản lý đặt. Đổi điểm lấy quà trong danh mục; người quản lý duyệt yêu cầu ở Trung tâm xử lý và bạn xem được lịch sử đổi quà."],
      },
    ],
  },
  {
    id: "settings",
    icon: "settings",
    title: ["Settings", "Cài đặt"],
    intro: ["Workspace, members, task configuration, your profile and data.", "Workspace, thành viên, cấu hình task, hồ sơ cá nhân và dữ liệu."],
    path: "/settings",
    topics: [
      {
        id: "members",
        title: ["Members and roles", "Thành viên và vai trò"],
        body: ["Owner, Admin, Editor, Contributor and Viewer — each role is described in the list. Invite by email or a shared link; invitees must accept. Change roles in a draft and press Save.", "Chủ sở hữu, Quản trị, Biên tập, Đóng góp và Chỉ xem — mỗi vai trò có mô tả trong danh sách. Mời qua email hoặc link mời chung; người được mời phải đồng ý. Đổi vai trò ở bản nháp rồi bấm Lưu."],
        tips: [["Hand over what a member owns (projects, objectives, key results) before removing them.", "Chuyển giao những gì một thành viên sở hữu (dự án, mục tiêu, key result) trước khi xoá họ."]],
      },
      {
        id: "ownership",
        title: ["Transfer workspace ownership", "Chuyển quyền sở hữu workspace"],
        body: ["A workspace always has exactly one owner. The owner picks the new owner and their own new role, and confirms. If the owner changes their own role, the transfer dialog opens.", "Mỗi workspace luôn có đúng một chủ sở hữu. Chủ sở hữu chọn người mới và vai trò mới của mình, rồi xác nhận. Nếu chủ sở hữu tự đổi vai trò của mình, hộp thoại chuyển quyền sẽ mở ra."],
      },
      {
        id: "permissions",
        title: ["Permissions by role", "Quyền hạn theo vai trò"],
        body: ["A table of what each role may do. Finer control: hide projects from chosen people, per-project rights, per-wiki roles, per-view access.", "Bảng tổng hợp vai trò nào được làm gì. Chi tiết hơn: ẩn dự án với người chọn, quyền theo dự án, vai trò theo wiki, quyền theo view."],
      },
      {
        id: "statuses",
        title: ["Task statuses", "Trạng thái task"],
        body: ["Name, color and group (to do / in progress / done) of the shared statuses. The group decides which tasks count as complete in reports and OKRs.", "Tên, màu và nhóm (chưa làm / đang làm / xong) của các trạng thái dùng chung. Nhóm trạng thái quyết định task nào được tính là hoàn thành trong báo cáo và OKR."],
      },
      {
        id: "profile",
        title: ["Profile & AI, appearance, notifications", "Hồ sơ & AI, giao diện, thông báo"],
        body: ["Profile: avatar, name, job title, an introduction for the AI and how it should answer (language, tone). Appearance: light / dark / system, tone, accent color, text size, language. Notifications: types, desktop pop-ups and sounds.", "Hồ sơ: ảnh đại diện, tên, chức danh, giới thiệu cho AI và cách AI nên trả lời (ngôn ngữ, giọng văn). Giao diện: sáng / tối / theo hệ thống, tông màu, màu nhấn, cỡ chữ, ngôn ngữ. Thông báo: loại thông báo, popup desktop và âm thanh."],
        tips: [["Write \"Always answer in Vietnamese\" in How AI should respond and every AI feature follows it.", "Ghi \"Luôn trả lời bằng tiếng Việt\" trong Cách AI nên trả lời để mọi tính năng AI tuân theo."]],
      },
      {
        id: "data",
        title: ["Import / export, history, audit, security", "Nhập / xuất, lịch sử, nhật ký, bảo mật"],
        body: ["Import tasks from Excel with the downloadable template (a sheet to fill and a guide sheet), export data, view project history and the audit log, and read how your data is protected (Security). Change your password from the profile menu at the top right.", "Nhập task từ Excel bằng file mẫu tải về (một sheet để điền, một sheet hướng dẫn), xuất dữ liệu, xem lịch sử dự án và nhật ký hoạt động, và xem dữ liệu được bảo vệ thế nào (Bảo mật). Đổi mật khẩu ở menu cá nhân góc trên bên phải."],
      },
    ],
  },
  {
    id: "shortcuts",
    icon: "keyboard",
    title: ["Search, shortcuts & devices", "Tìm kiếm, phím tắt & thiết bị"],
    intro: ["Move faster with the keyboard, on any screen size.", "Thao tác nhanh bằng bàn phím, trên mọi kích thước màn hình."],
    topics: [
      {
        id: "search",
        title: ["Quick search (Ctrl K)", "Tìm nhanh (Ctrl K)"],
        body: ["Press Ctrl K (Cmd K on Mac) or click the search box. Type to find tasks, projects, pages and people; ↑ ↓ to choose, Enter to open, Esc to close.", "Nhấn Ctrl K (Cmd K trên Mac) hoặc bấm ô tìm kiếm. Gõ để tìm task, dự án, trang, người; ↑ ↓ để chọn, Enter để mở, Esc để đóng."],
      },
      {
        id: "keys",
        title: ["Keyboard in the table", "Bàn phím trong bảng"],
        body: ["Ctrl C / Ctrl V copy and paste cells, ranges or whole rows, Ctrl D fills down, Esc closes menus and cancels editing, Enter confirms.", "Ctrl C / Ctrl V sao chép và dán ô, vùng ô hoặc cả dòng, Ctrl D điền xuống, Esc đóng menu và huỷ sửa, Enter xác nhận."],
      },
      {
        id: "devices",
        title: ["Phone, tablet and desktop app", "Điện thoại, máy tính bảng và ứng dụng máy tính"],
        body: ["woli works in the browser on phones and tablets (row actions are always visible on touch screens). A Windows desktop app uses the same account and data — download it from the sidebar.", "woli chạy trên trình duyệt của điện thoại và máy tính bảng (nút thao tác trên dòng luôn hiện trên màn hình cảm ứng). Ứng dụng Windows dùng cùng tài khoản và dữ liệu — tải từ thanh bên."],
      },
    ],
  },
  {
    id: "faq",
    icon: "life",
    title: ["Tips & FAQ", "Mẹo & câu hỏi thường gặp"],
    intro: ["Habits that help and answers to common questions.", "Thói quen nên có và giải đáp thường gặp."],
    topics: [
      {
        id: "habits",
        title: ["Good habits", "Thói quen nên có"],
        body: ["Start the day on Home and focus on the first task; clear the Action center daily; discuss on the task with @mentions instead of private messages; let AI draft weekly reports, then check them.", "Bắt đầu ngày ở Trang chủ và tập trung vào việc đầu tiên; dọn Trung tâm xử lý mỗi ngày; trao đổi trên task bằng @nhắc tên thay vì nhắn riêng; để AI soạn báo cáo tuần rồi kiểm tra lại."],
      },
      {
        id: "cant-see",
        title: ["I can't see a project or I can't edit", "Tôi không thấy dự án hoặc không sửa được"],
        body: ["The project owner may have hidden the project from you or limited your rights in Project settings → Permissions; your workspace role also sets the maximum. Ask the project owner or a workspace admin.", "Chủ dự án có thể đã ẩn dự án hoặc giới hạn quyền của bạn ở Cài đặt dự án → Phân quyền; vai trò workspace cũng là mức tối đa. Hãy hỏi chủ dự án hoặc quản trị workspace."],
      },
      {
        id: "privacy",
        title: ["Is HR data safe with AI?", "Dữ liệu nhân sự có an toàn với AI không?"],
        body: ["AI only receives what the asking person may see, and only when a workspace admin turned AI on. Hide sensitive projects from people who don't need them.", "AI chỉ nhận dữ liệu người hỏi được xem, và chỉ khi quản trị workspace đã bật AI. Hãy ẩn dự án nhạy cảm với người không liên quan."],
      },
      {
        id: "support",
        title: ["Need more help?", "Cần hỗ trợ thêm?"],
        body: ["Contact your workspace admin, or read the full user guide (Word / PowerPoint) shared by your team.", "Liên hệ quản trị workspace, hoặc đọc tài liệu hướng dẫn sử dụng đầy đủ (Word / PowerPoint) nhóm bạn chia sẻ."],
      },
    ],
  },
];

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();

/** Topics whose text (either language) contains every word of the query; accents are ignored. */
export function searchHelp(query: string): { tab: HelpTab; topic: HelpTopic }[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const out: { tab: HelpTab; topic: HelpTopic }[] = [];
  for (const tab of HELP_TABS)
    for (const topic of tab.topics) {
      const text = fold([tab.title, topic.title, topic.body, ...(topic.steps ?? []), ...(topic.tips ?? [])].flat().join(" "));
      if (words.every((w) => text.includes(w))) out.push({ tab, topic });
    }
  return out;
}
