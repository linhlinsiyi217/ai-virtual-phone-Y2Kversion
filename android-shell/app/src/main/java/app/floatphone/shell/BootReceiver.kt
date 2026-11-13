package app.floatphone.shell

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** 开机自启推送服务（部分国产 ROM 需用户在系统设置里允许自启动才会生效）。 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED || intent.action == Intent.ACTION_MY_PACKAGE_REPLACED) {
            // 只有之前真正登录并启用过壳推送，重启手机后才恢复后台连接。
            if (PushService.isAccountReady(context)) {
                PushWatchdogReceiver.scheduleSoon(context)
                runCatching { PushService.start(context) }
            }
        }
    }
}
