# IT 岗位技能图谱

## 一、后端开发

### Java 工程师

**核心技能（必需）：**
- 语言：Java 8+/11/17
- 框架：Spring Boot, Spring MVC, MyBatis/MyBatis-Plus
- 数据库：MySQL, Redis
- 工具：Maven/Gradle, Git, IntelliJ IDEA
- 基础：JVM 原理、多线程并发、集合框架、IO/NIO

**进阶技能（加分）：**
- 微服务：Spring Cloud (Eureka/Gateway/Feign), Dubbo, Nacos
- 容器化：Docker, Kubernetes
- 消息队列：RabbitMQ, Kafka, RocketMQ
- 搜索：Elasticsearch
- 数据库进阶：MongoDB, PostgreSQL, 分库分表 (ShardingSphere)
- 监控：Prometheus, Grafana, SkyWalking
- 设计：领域驱动设计 (DDD), 设计模式

**语义等价技能：**
| JD 写法 | 等价技能 |
|---|---|
| 熟悉 Spring | Spring Boot / Spring MVC / Spring Cloud |
| 有分布式经验 | 微服务 + 消息队列 + 分布式缓存 |
| 熟悉 ORM | MyBatis / MyBatis-Plus / JPA / Hibernate |
| 高并发经验 | Redis + 消息队列 + 线程池 + 数据库优化 |
| 有大型项目经验 | 3年以上 + 微服务/分布式 + 高并发 |

**经验-技能对应：**
| 年限 | 预期能力 |
|---|---|
| 1-2年 | CRUD + 基础框架使用 + 单体项目 |
| 3-5年 | 微服务 + 性能优化 + 独立负责模块 |
| 5-8年 | 架构设计 + 技术选型 + 团队技术决策 |
| 8年+ | 技术规划 + 跨团队架构 + 技术体系建设 |

---

### Python 工程师

**核心技能（必需）：**
- 语言：Python 3.8+
- 框架：Django / Flask / FastAPI
- 数据库：MySQL, PostgreSQL, Redis
- 工具：pip/conda, Git, Jupyter

**进阶技能（加分）：**
- 数据处理：Pandas, NumPy, Spark
- 爬虫：Scrapy, Selenium, BeautifulSoup
- AI/ML：PyTorch, TensorFlow, scikit-learn
- 部署：Docker, Nginx, Celery
- 大数据：Hadoop, Hive, Flink

**语义等价技能：**
| JD 写法 | 等价技能 |
|---|---|
| 熟悉 Web 开发 | Django / Flask / FastAPI |
| 有数据分析经验 | Pandas + NumPy + SQL |
| 有 AI 经验 | PyTorch / TensorFlow / scikit-learn |
| 有爬虫经验 | Scrapy / Selenium / Requests |

---

### Go 工程师

**核心技能（必需）：**
- 语言：Go
- 框架：Gin, Echo, Go-Zero
- 数据库：MySQL, Redis, MongoDB
- 工具：Go Modules, Git

**进阶技能（加分）：**
- 微服务：gRPC, Protobuf, Go-Kratos
- 容器化：Docker, Kubernetes（Go 是 K8s 的开发语言）
- 消息队列：Kafka, NATS
- 云原生：etcd, Consul, Istio

---

## 二、前端开发

### 前端工程师

**核心技能（必需）：**
- 语言：HTML5, CSS3, JavaScript (ES6+), TypeScript
- 框架：Vue 2/3 或 React
- 工具：Webpack/Vite, Git, npm/yarn/pnpm
- 基础：浏览器原理、HTTP 协议、响应式布局

**进阶技能（加分）：**
- 状态管理：Vuex/Pinia (Vue) / Redux/Zustand (React)
- UI 库：Element Plus / Ant Design / Naive UI
- 移动端：UniApp / React Native / 小程序
- 工程化：CI/CD, ESLint, 单元测试 (Jest/Vitest)
- 可视化：ECharts, D3.js, Three.js
- SSR：Nuxt.js / Next.js

**语义等价技能：**
| JD 写法 | 等价技能 |
|---|---|
| 熟悉 Vue | Vue 2/3 + Vuex/Pinia + Vue Router + Element/Naive |
| 熟悉 React | React + Redux/Zustand + React Router + Ant Design |
| 熟悉前端框架 | Vue 或 React（通常二选一精通） |
| 有小程序经验 | 微信小程序 / UniApp / Taro |
| 有中后台经验 | Element/Ant Design + 表单/表格/权限管理 |
| 有移动端经验 | React Native / UniApp / Flutter |
| 有可视化经验 | ECharts / D3.js / AntV |

**Vue vs React 对照：**
| 维度 | Vue 生态 | React 生态 |
|---|---|---|
| 框架 | Vue 3 | React 18 |
| 状态管理 | Pinia | Redux / Zustand |
| 路由 | Vue Router | React Router |
| UI 库 | Element Plus / Naive UI | Ant Design / Arco Design |
| 构建工具 | Vite | Vite / Webpack |
| SSR | Nuxt.js | Next.js |

---

## 三、测试工程师

### 功能测试

**核心技能（必需）：**
- 理论：测试用例设计方法（等价类/边界值/正交法）
- 工具：Jira/禅道, Postman, Fiddler/Charles
- 类型：功能测试、接口测试、回归测试、兼容性测试
- 文档：测试计划、测试报告、Bug 跟踪

**进阶技能（加分）：**
- 自动化：Selenium, Appium, Playwright
- 性能测试：JMeter, Locust
- 安全测试：Burp Suite, SQL 注入/XSS 基础

### 自动化测试

**核心技能（必需）：**
- 语言：Python / Java
- 框架：Pytest / TestNG / JUnit
- UI 自动化：Selenium, Playwright, Appium
- 接口自动化：Requests, Postman (Newman), HTTPClient
- CI 集成：Jenkins, GitLab CI

**语义等价技能：**
| JD 写法 | 等价技能 |
|---|---|
| 有自动化经验 | Selenium/Playwright + Pytest/TestNG |
| 有接口测试经验 | Postman / Requests / HTTPClient |
| 有性能测试经验 | JMeter / Locust |
| 有持续集成经验 | Jenkins / GitLab CI / GitHub Actions |

---

## 四、DevOps / 运维

**核心技能（必需）：**
- 系统：Linux (CentOS/Ubuntu)
- 容器：Docker, Docker Compose
- CI/CD：Jenkins, GitLab CI, GitHub Actions
- 监控：Prometheus, Grafana, Zabbix
- 网络：Nginx, DNS, 负载均衡

**进阶技能（加分）：**
- 容器编排：Kubernetes, Helm
- 云平台：阿里云/AWS/腾讯云
- 基础设施即代码：Terraform, Ansible
- 日志：ELK (Elasticsearch + Logstash + Kibana)

---

## 五、数据相关

### 数据开发

**核心技能：**
- 语言：SQL, Python, Java/Scala
- 大数据：Hadoop, Hive, Spark, Flink
- 数据仓库：维度建模, ETL, 数据湖
- 工具：Airflow, DataX, Canal

### 数据分析

**核心技能：**
- 语言：SQL, Python (Pandas)
- 可视化：Tableau, Power BI, ECharts
- 统计：A/B 测试, 漏斗分析, 归因分析
- 工具：Excel 高级, Jupyter

---

## 六、项目管理

### 技术项目经理 / PM

**核心技能：**
- 方法论：敏捷 (Scrum/Kanban), 瀑布
- 工具：Jira, Confluence, 飞书/钉钉
- 文档：PRD, 需求规格, 项目计划
- 能力：需求分析, 风险管理, 跨团队协调

---

## 七、岗位-技能-经验 快速映射表

| 岗位 | 核心技能关键词 | 最低年限 | 典型薪资(杭州) |
|---|---|---|---|
| Java 初级 | Spring Boot + MySQL + Redis | 1-2年 | 8-12K |
| Java 中级 | Spring Cloud + MQ + 分库分表 | 3-5年 | 15-25K |
| Java 高级 | DDD + 架构设计 + K8s | 5-8年 | 25-40K |
| 前端 初级 | Vue/React + CSS + JS | 1-2年 | 8-12K |
| 前端 中级 | 状态管理 + 工程化 + 小程序 | 3-5年 | 15-25K |
| 前端 高级 | SSR + 可视化 + 架构 | 5年+ | 25-35K |
| 测试 初级 | 用例设计 + 接口测试 + Jira | 1-2年 | 7-10K |
| 测试 中级 | 自动化 + 性能测试 + CI | 3-5年 | 12-20K |
| Python 初级 | Django/Flask + MySQL | 1-2年 | 8-13K |
| Python 中级 | 数据处理 + 部署 + 异步 | 3-5年 | 15-25K |
| Go 中级 | Gin/gRPC + K8s + 微服务 | 2-5年 | 18-30K |
| DevOps | Linux + Docker + K8s + CI/CD | 3年+ | 18-35K |
