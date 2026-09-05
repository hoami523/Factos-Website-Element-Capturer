# Element Capture Pro

一个面向 Chrome / Chromium 系浏览器（Chrome、Edge、Brave、Opera 等）的**元素捕捉扩展**：Alt+点击捕捉网页元素，自动生成 **CSS 选择器 + XPath**，并附带 Playwright / Selenium 完整表达式；支持多层 iframe 嵌套（含跨域）。捕捉结果累积成「元素库」，可导出为**简洁文本 / 简洁 JSON**（直接拿到 CSS、XPath，无需写解析脚本），也可导出完整 JSON。

## 功能

- 常驻侧边栏：点击工具栏图标打开，切换页面/点击页面都不会关闭
- 页面浮层：拾取时页面底部实时显示状态与已捕捉数量，捕捉成功立刻弹提示
- 拾取模式：hover 高亮 + Alt+点击捕捉（普通点击完全放行，不干扰页面操作），Esc 或浮层「停止」退出
- 浏览模式：按 `B` 或点浮层「浏览」按钮，所有点击放行、高亮关闭；再按一次恢复
- 每个元素同时输出：纯 CSS、纯 XPath、Playwright 表达式、Selenium 表达式
- 稳定属性优先：依次优先使用 id、data-testid、name、aria-label、placeholder 等属性，减少对 DOM 层级和位置序号（`nth-of-type` / `div[2]`）的依赖
- 稳定 frame 定位器：自动识别 iframe name 中的动态 token（如 `$$2nx6aplmtjw`），生成按前缀 / src 匹配的稳定表达式
- 唯一性校验：每个候选定位器都在捕捉时验证过全文档唯一匹配
- iframe 支持：任意层嵌套、跨域 iframe 均可解析完整 frame 链
- 元素库：自动命名（`element_1`、`element_2`…），可改名、删除
- 导出：单个复制 / 全部复制 / 下载 `elements_日期_时间.txt|json`（同一天多次导出不覆盖）
- 导出后自动清空：侧边栏可勾选，导出成功后自动清空元素库，适合长期使用不堆积
- 定位回查：点元素卡片上的「定位」，页面中对应元素会自动滚动到视野并红绿闪烁（支持 iframe 内元素）

## 安装

需要 Chrome 114+（含 Edge、Brave 等 Chromium 衍生浏览器，侧边栏 API 从 114 开始支持）。

1. 打开 `chrome://extensions`
2. 打开右上角「开发者模式」
3. 点击「加载已解压的扩展程序」，选择本目录
4. 重新加载后，点击工具栏的扩展图标即可打开常驻侧边栏
5. 如果要捕捉 `file://` 页面（如本仓库的测试页），需要在该扩展详情里开启「允许访问文件网址」，并刷新页面

扩展更新或重新加载后，已打开页面里的捕捉脚本会自动重新注入，一般无需手动刷新页面即可继续拾取（极少数情况下个别页面仍可能需要刷新一次）。

## 使用

1. 点击工具栏的扩展图标，打开常驻侧边栏（不随页面操作关闭）
2. 点「开始拾取」；页面底部出现拾取浮层（状态、已捕捉数量、「停止」按钮）
3. 在页面上移动鼠标预览高亮，按住 Alt 点击目标元素即捕捉成功，浮层上方弹出「✓ 已捕捉 element_x」提示
4. 可连续捕捉多个元素；按 `Esc` 或点浮层的「停止」退出拾取
5. 侧边栏实时列出捕捉结果：改名、复制 CSS / XPath / JSON、导出元素库

点卡片上的「定位」按钮，会在当前页面沿 `frame_path` 下钻到目标 iframe（跨域同样支持），找到元素后滚动到视野并闪烁提示。如果页面已变化或已离开捕捉时的页面，会提示「未找到对应元素」。

元素位于 iframe 内时，卡片上会多出一行「帧链」；点「CSS」或「XPath」复制的内容会先按外→内列出各层 iframe 的稳定定位器（每行一条），最后一行为元素自身的选择器。顶层元素则只有一行。例如：

```
//iframe[starts-with(@name,'cbsswebiframe_cbsBIL6531_2I')]
//div[@id='formserialNumber']/div/input
```

侧边栏设置里可勾选「捕捉后弹出命名窗（强制命名）」：每次拾取成功后，页面中央弹出命名窗（预填建议名如 `按钮-登录` 并选中），直接打字即可改名，回车确认、Esc 跳过（使用自动名称）。

## 导出格式

侧边栏「导出格式」下拉框提供三种格式，「导出」与「复制全部」都会按所选格式输出。

### 简洁文本（.txt，默认）

每行一个元素，4 个字段用 **Tab** 分隔：`名称`、`CSS`、`XPath`、`帧链`。帧链是各层 iframe 的 CSS 定位器（优先使用稳定版），由外到内用逗号连接，顶层元素为空。不需要任何 JSON 解析，按行读、按 Tab 切分即可：

```
登录按钮	button#login-btn	//button[@id='login-btn']	
主区域输入框	input#username	//input[@id='username']	iframe#main
```

消费示例（Python）：

```python
with open('elements_2026-08-18_120000.txt', encoding='utf-8') as f:
    for line in f:
        name, css, xpath, frames = line.rstrip('\n').split('\t')
        chain = frames.split(',') if frames else []
        print(name, css, xpath, chain)
```

### 简洁 JSON

扁平数组，每个元素只有 4 个字段，`css` / `xpath` 一眼可取：

```json
[
  {
    "name": "登录按钮",
    "css": "button#login-btn",
    "xpath": "//button[@id='login-btn']",
    "frames": []
  },
  {
    "name": "主区域输入框",
    "css": "input#username",
    "xpath": "//input[@id='username']",
    "frames": ["iframe#main"]
  }
]
```

### 完整 JSON

保留全部细节（元素属性、候选定位器、唯一性校验、Playwright / Selenium 表达式、frame_path 稳定版等）：

```json
{
  "schema_version": "1",
  "exported_at": "2026-08-18T12:00:00+08:00",
  "elements": [
    {
      "name": "element_1",
      "page": { "url": "https://example.com/admin/login", "title": "登录" },
      "frame_path": [
        {
          "tag": "iframe",
          "id": "main",
          "src": "/main.html",
          "css": "iframe#main",
          "xpath": "//iframe[@id='main']",
          "stable": {
            "kind": "id",
            "css": "iframe#main",
            "xpath": "//iframe[@id='main']",
            "verified": true,
            "alternatives": []
          }
        }
      ],
      "element": {
        "tag": "button",
        "id": "login-btn",
        "class": "btn primary",
        "text": "登录",
        "attrs": { "data-testid": "loginButton" }
      },
      "locators": {
        "css": "button#login-btn",
        "xpath": "//button[@id='login-btn']",
        "playwright_css": "page.frameLocator('iframe#main').locator('button#login-btn')",
        "playwright_xpath": "page.frameLocator('iframe#main').locator(\"//button[@id='login-btn']\")",
        "selenium_css": "driver.switchTo().frame('main').findElement(By.css('button#login-btn'))",
        "selenium_xpath": "driver.switchTo().frame('main').findElement(By.xpath(\"//button[@id='login-btn']\"))",
        "playwright_css_stable": "page.frameLocator('iframe#main').locator('button#login-btn')",
        "playwright_xpath_stable": "page.frameLocator('iframe#main').locator(\"//button[@id='login-btn']\")",
        "selenium_css_stable": "driver.switchTo().frame(driver.findElement(By.css('iframe#main'))).findElement(By.css('button#login-btn'))",
        "selenium_xpath_stable": "driver.switchTo().frame(driver.findElement(By.css('iframe#main'))).findElement(By.xpath(\"//button[@id='login-btn']\"))"
      },
      "verified": { "css": true, "xpath": true, "at": "2026-08-18T12:00:00+08:00" }
    }
  ]
}
```

`frame_path` 为结构化数组（外层在前），每一层都给出该 iframe 在父文档里的 CSS / XPath。即使你的框架不支持 `frameLocator`，也可以根据数组自己生成 frame 切换代码。

### 稳定 frame 定位器（`stable` / `*_stable`）

有些系统的 iframe `name` 或 `src` 里带动态 token，比如 `cbsswebiframe_cbsBIL6531_2I$$2nx6aplmtjw`（`$$` 后面是每次会话都会变的随机串），直接复制 `playwright_css` / `selenium_css` 到新会话里会失效。

插件在捕捉时会自动生成稳定版本：

- 识别 `name` 中 `$$` 分隔的动态后缀，用前缀匹配：`iframe[name^="cbsswebiframe_cbsBIL6531_2I"]`
- 退而用 `src` 的路径或 `service` 参数：`iframe[src*="/ambillquerypls"]`
- 没有明显动态特征时保持原定位器（`kind: "unchanged"`）

每个候选都在捕捉时做唯一性校验：`verified: true` 表示当时只匹配到这一个 iframe；`false` 表示同时匹配到多个（比如开了多个同业务标签页），使用时要留意。完整 JSON 里的 `*_stable` 字段就是稳定版表达式；卡片上会显示「稳定 · name前缀」之类的徽章。

## iframe 实现原理

内容脚本以 `all_frames: true` 注入所有 frame。点击命中哪个 frame，就由那个 frame 在自己的文档内生成定位器；随后通过 `postMessage` 协议逐层向父 frame 上报，父 frame 用 `event.source` 比对其下的 iframe 元素，递归到顶层后把完整 frame 链回传。`event.source` 比对在跨域场景同样有效，因此**跨域 iframe 也支持**。

## 拾取中需要操作页面怎么办

- **直接操作**：普通点击就是正常操作（点按钮、切标签页、提交都行），绝不会误捕捉
- **捕捉元素**：鼠标悬停预览高亮，对准后按住 `Alt` 点击目标元素即可
- **浏览模式**：按 `B` 键或点浮层「浏览」可关闭高亮预览与捕捉（所有 iframe 层级一起生效）；再按 `B` 或点「拾取」恢复。焦点在侧边栏时按 `B` / `Esc` 同样生效（会自动转发到页面）
- 同一时刻只高亮最内层元素：鼠标进入 iframe 时，父页面不再叠加高亮框
- 拾取状态跨页面保持：切页后（整页跳转或 SPA 切换）新页面会自动恢复拾取模式，直接继续捕捉即可

如果点「开始拾取」无反应或提示错误：

- 当前是 `chrome://` 等浏览器内部页面 → 无法注入，请切换到普通网页
- 当前是 `file://` 页面 → 需在扩展详情开启「允许访问文件网址」后刷新页面；授权后刷新，警告会自动消失
- 其他情况 → 刷新页面后重试

所有警告都可以点右上角 `×` 手动关闭。

## 已知限制

- 完全 sandbox（未开 `allow-scripts`）的 iframe 无法运行任何脚本，插件进不去，会在结果里标记「iframe 链未解析」
- closed shadow DOM 内部元素定位会退回到宿主元素
- 定位器唯一性在捕捉时刻校验；SPA 动态渲染后可能失效，建议在脚本里做运行时重试
- 本扩展只负责「捕捉」；需要运行时自动操作时，请配合 Playwright / Selenium 等脚本使用

## 测试页

打开 `test/test.html`（需启用扩展的「允许访问文件网址」），包含：

- 顶层元素（带 id / data-testid / class）
- 同域一层 iframe
- iframe 里再嵌一层 iframe（两层嵌套）
- srcdoc iframe

可以分别在各个层级里捕捉元素，验证 frame 链是否正确。
