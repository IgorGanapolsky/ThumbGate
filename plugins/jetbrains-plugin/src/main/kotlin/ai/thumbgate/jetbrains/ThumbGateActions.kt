package ai.thumbgate.jetbrains

import com.intellij.ide.BrowserUtil
import com.intellij.notification.NotificationGroupManager
import com.intellij.notification.NotificationType
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import java.nio.file.Files
import java.nio.file.Path

private const val DASHBOARD_URL = "https://thumbgate-production.up.railway.app/dashboard?utm_source=jetbrains&utm_medium=plugin&utm_campaign=dashboard"

class ThumbGateInitProjectAction : AnAction() {
    override fun actionPerformed(event: AnActionEvent) {
        val project = event.project ?: return
        val basePath = project.basePath ?: return
        val mcpPath = Path.of(basePath, ".mcp.json")
        val body = """
            {
              "mcpServers": {
                "thumbgate": {
                  "command": "npx",
                  "args": ["--yes", "--package", "thumbgate@latest", "thumbgate", "serve"]
                }
              }
            }
        """.trimIndent() + "\n"

        Files.writeString(mcpPath, body)
        notify(project.name, "ThumbGate MCP config written to .mcp.json")
    }
}

class ThumbGateOpenDashboardAction : AnAction() {
    override fun actionPerformed(event: AnActionEvent) {
        BrowserUtil.browse(DASHBOARD_URL)
    }
}

private fun notify(title: String, message: String) {
    NotificationGroupManager.getInstance()
        .getNotificationGroup("System Messages")
        .createNotification(title, message, NotificationType.INFORMATION)
        .notify(null)
}
