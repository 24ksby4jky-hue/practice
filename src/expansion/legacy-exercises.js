export const TOPICS = [
  { id: "campus", name: "校园学习" },
  { id: "daily", name: "日常生活" },
  { id: "work", name: "工作与职业" },
  { id: "society", name: "科技与社会" }
];
export const LEVELS = [{ id: "basic", name: "基础", note: "常用词汇，短语扩写" },
  { id: "advanced", name: "进阶", note: "自然搭配，尝试从句" }];

const step = (goal, hint, reference) => ({ goal, hint, reference });
const exercise = (id, topic, core, meaning, steps) => ({ id, topic, core, meaning, steps });

export const EXERCISES = [
  exercise("campus-books", "campus", "Students read books.", "学生读书。", [
    step("补充学生读什么样的书。", "可以用 about + 主题，修饰 books。", "Students read books about science."),
    step("保留上一步的信息，补充时间或地点。", "想一想：in the library / after class。", "Students read books about science in the library after class."),
    step("补充读书的目的。", "用 to + 动词表达目的，例如 understand。", "Students read books about science in the library after class to better understand the natural world.")
  ]),
  exercise("campus-discuss", "campus", "We discuss ideas.", "我们讨论想法。", [
    step("说明讨论什么方面的想法。", "用 for our project，说明想法的用途。", "We discuss ideas for our science project."),
    step("补充讨论的时间或方式。", "可以添加 in small groups。", "We discuss ideas for our science project in small groups after class."),
    step("说明这样讨论有什么好处。", "可以用 so that we can… 引出结果。", "We discuss ideas for our science project in small groups after class so that we can learn from each other.")
  ]),
  exercise("campus-teacher", "campus", "The teacher explains a concept.", "老师讲解一个概念。", [
    step("说明讲解的是哪一类概念。", "用 difficult 或与科目有关的修饰语。", "The teacher explains a difficult mathematical concept."),
    step("补充老师如何讲解。", "尝试 using + 名词，说明使用的材料。", "The teacher explains a difficult mathematical concept using simple diagrams."),
    step("补充讲解的目的。", "可以用 to help students…，保留教师讲解这一核心。", "The teacher explains a difficult mathematical concept using simple diagrams to help students understand it more easily.")
  ]),
  exercise("campus-notes", "campus", "I take notes.", "我做笔记。", [
    step("补充笔记的内容或特点。", "可以用 detailed 修饰 notes。", "I take detailed notes on key ideas."),
    step("说明什么时候做笔记。", "尝试 during + 一段活动。", "I take detailed notes on key ideas during lectures."),
    step("说明做笔记的原因。", "可以用 because 引出记忆或复习方面的原因。", "I take detailed notes on key ideas during lectures because they help me prepare for exams.")
  ]),
  exercise("campus-club", "campus", "She joins a club.", "她加入一个社团。", [
    step("说明社团的类型。", "例如 a photography club。", "She joins a photography club."),
    step("补充社团所在的地方或活动安排。", "可以用 at her university。", "She joins a photography club at her university."),
    step("说明她加入的目的。", "尝试两个并列目的：to… and…。", "She joins a photography club at her university to develop her skills and meet people with similar interests.")
  ]),
  exercise("daily-cook", "daily", "I cook dinner.", "我做晚饭。", [
    step("补充晚饭的特点或食材。", "可以添加 a simple dinner / with fresh vegetables。", "I cook a simple dinner with fresh vegetables."),
    step("说明为谁或何时做饭。", "例如 for my family / every evening。", "I cook a simple dinner with fresh vegetables for my family every evening."),
    step("说明这样做的原因。", "用 because，考虑健康或家庭生活。", "I cook a simple dinner with fresh vegetables for my family every evening because we want to eat more healthily.")
  ]),
  exercise("daily-walk", "daily", "He takes a walk.", "他散步。", [
    step("补充散步的地点。", "例如 along the river。", "He takes a walk along the river."),
    step("补充时间或陪伴的人。", "例如 with his dog / before breakfast。", "He takes a walk along the river with his dog before breakfast."),
    step("说明散步带来的作用。", "可以用 to clear his mind，表达目的。", "He takes a walk along the river with his dog before breakfast to clear his mind before work.")
  ]),
  exercise("daily-market", "daily", "They visit a market.", "他们逛市场。", [
    step("补充市场的类型或位置。", "可以用 local 修饰 market。", "They visit a local farmers' market."),
    step("补充频率或时间。", "例如 every Sunday morning。", "They visit a local farmers' market every Sunday morning."),
    step("补充去市场的目的。", "用 to buy…，说明购买什么。", "They visit a local farmers' market every Sunday morning to buy fresh produce directly from local growers.")
  ]),
  exercise("daily-friend", "daily", "My friend calls me.", "朋友给我打电话。", [
    step("补充朋友的背景。", "用 who… 描述朋友，或用 close 修饰 friend。", "My close friend calls me."),
    step("补充通话的时间或频率。", "例如 every weekend。", "My close friend calls me every weekend."),
    step("说明打电话的目的。", "可以用 to share… and hear…。", "My close friend calls me every weekend to share news and hear about my week.")
  ]),
  exercise("daily-train", "daily", "We take the train.", "我们乘火车。", [
    step("补充列车的类型或目的地。", "例如 the early train to the city。", "We take the early train to the city."),
    step("补充时间或频率。", "例如 on weekday mornings。", "We take the early train to the city on weekday mornings."),
    step("解释选择火车的原因。", "用 because，比较通勤便利性。", "We take the early train to the city on weekday mornings because it is more reliable than driving through heavy traffic.")
  ]),
  exercise("work-meeting", "work", "The team holds a meeting.", "团队开会。", [
    step("说明会议的类型或主题。", "例如 a short planning meeting。", "The team holds a short planning meeting."),
    step("补充会议的时间或方式。", "例如 online / every Monday。", "The team holds a short planning meeting online every Monday."),
    step("说明会议的目的。", "用 to review… and agree on…。", "The team holds a short planning meeting online every Monday to review progress and agree on priorities.")
  ]),
  exercise("work-report", "work", "She writes a report.", "她写报告。", [
    step("说明报告的内容。", "用 on + 主题，修饰 report。", "She writes a report on customer feedback."),
    step("说明报告使用的资料或写作方式。", "例如 using data from a recent survey。", "She writes a report on customer feedback using data from a recent survey."),
    step("说明报告的用途。", "可以用 to help the company…。", "She writes a report on customer feedback using data from a recent survey to help the company improve its service.")
  ]),
  exercise("work-skills", "work", "Employees learn new skills.", "员工学习新技能。", [
    step("具体说明技能的类型。", "例如 digital skills。", "Employees learn new digital skills."),
    step("补充学习的途径。", "用 through + 培训方式。", "Employees learn new digital skills through weekly workshops."),
    step("说明学习的目的或结果。", "可以用 so that they can…。", "Employees learn new digital skills through weekly workshops so that they can adapt to changes in their work.")
  ]),
  exercise("work-manager", "work", "The manager listens.", "经理倾听。", [
    step("说明经理听取谁的意见。", "listen 后接对象时需要 to。", "The manager listens to employees' suggestions."),
    step("补充倾听的方式或时间。", "例如 carefully / during team discussions。", "The manager listens carefully to employees' suggestions during team discussions."),
    step("说明倾听的目的。", "用 to identify…，思考团队的问题。", "The manager listens carefully to employees' suggestions during team discussions to identify problems before they become serious.")
  ]),
  exercise("work-business", "work", "He starts a business.", "他创业。", [
    step("说明企业提供什么服务。", "可以用 that provides… 修饰 business。", "He starts a business that provides bicycle repairs."),
    step("补充经营地点或服务对象。", "例如 in his neighborhood。", "He starts a business that provides bicycle repairs in his neighborhood."),
    step("解释创业的原因。", "可以用 because he notices…。", "He starts a business that provides bicycle repairs in his neighborhood because he notices a growing demand for affordable repairs.")
  ]),
  exercise("society-technology", "society", "Technology changes our lives.", "科技改变我们的生活。", [
    step("补充科技改变生活的具体方面。", "例如 the way we communicate。", "Technology changes the way we communicate."),
    step("补充它通过什么方式带来改变。", "用 by + 动词的 -ing 形式。", "Technology changes the way we communicate by connecting people across long distances."),
    step("补充这种改变的结果。", "可以用 making… 引出结果。", "Technology changes the way we communicate by connecting people across long distances, making collaboration easier.")
  ]),
  exercise("society-trees", "society", "Cities plant trees.", "城市种树。", [
    step("补充种树的地点。", "例如 along busy streets。", "Cities plant trees along busy streets."),
    step("补充树木的特点或种植方式。", "例如 native trees / as part of a green initiative。", "Cities plant native trees along busy streets as part of a green initiative."),
    step("说明种树的目的。", "可以用 to provide… and reduce…。", "Cities plant native trees along busy streets as part of a green initiative to provide shade and reduce summer temperatures.")
  ]),
  exercise("society-energy", "society", "People save energy.", "人们节约能源。", [
    step("补充节约能源的场所。", "例如 at home。", "People save energy at home."),
    step("补充具体做法。", "用 by switching off…。", "People save energy at home by switching off unused appliances."),
    step("说明这样做的好处。", "可以用 which helps… 引出影响。", "People save energy at home by switching off unused appliances, which helps lower household bills and reduce emissions.")
  ]),
  exercise("society-app", "society", "An app helps travelers.", "一个应用帮助旅行者。", [
    step("说明帮助旅行者做什么。", "help someone find…，find 前可以不加 to。", "An app helps travelers find affordable accommodation."),
    step("补充应用提供帮助的方式。", "用 by comparing…，说明比较什么。", "An app helps travelers find affordable accommodation by comparing prices and reviews."),
    step("补充带来的结果。", "可以用 so that they can…。", "An app helps travelers find affordable accommodation by comparing prices and reviews so that they can plan trips with greater confidence.")
  ]),
  exercise("society-volunteers", "society", "Volunteers help residents.", "志愿者帮助居民。", [
    step("说明帮助哪些居民、做什么。", "例如 help older residents use…。", "Volunteers help older residents use smartphones."),
    step("补充活动的时间或地点。", "例如 at a community center every Saturday。", "Volunteers help older residents use smartphones at a community center every Saturday."),
    step("说明这项活动的目的。", "用 to help them…，思考数字生活的便利。", "Volunteers help older residents use smartphones at a community center every Saturday to help them stay connected with family and access online services.")
  ])
];

export const exerciseById = (id) => EXERCISES.find((item) => item.id === id) || null;
