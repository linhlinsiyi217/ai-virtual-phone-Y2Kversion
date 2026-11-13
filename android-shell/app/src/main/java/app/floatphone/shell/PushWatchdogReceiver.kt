package app.floatphone.shell

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build

/**
 * 推送服务的系统级自检。
 *
 * START_STICKY 只能表达「系统有机会时请重建」，部分国产 ROM 仍可能长时间不拉起。
 * 这里再放一只低频闹钟：每 15 分钟检查一次，只有账号仍处于登录状态且服务确实
 * 不在运行时才尝试恢复。它不轮询业务数据、不唤醒网页，也不会重复创建服务。
 */
class PushWatchdogReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        if (!PushService.isAccountReady(context)) {
            cancel(context)
            return
        }
        if (!PushService.isRunning()) {
            runCatching { PushService.start(context) }
        }
        schedule(context)
    }

    companion object {
        private const val ACTION_WATCHDOG = "app.floatphone.shell.PUSH_WATCHDOG"
        private const val REQUEST_CODE = 7401
        private const val INTERVAL_MS = 15L * 60L * 1000L
        private const val SOON_MS = 20L * 1000L

        private fun pendingIntent(context: Context, flags: Int): PendingIntent? =
            PendingIntent.getBroadcast(
                context,
                REQUEST_CODE,
                Intent(context, PushWatchdogReceiver::class.java).setAction(ACTION_WATCHDOG),
                flags,
            )

        fun isScheduled(context: Context): Boolean =
            pendingIntent(context, PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE) != null

        fun schedule(context: Context, delayMs: Long = INTERVAL_MS) {
            if (!PushService.isAccountReady(context)) return
            val alarm = context.getSystemService(AlarmManager::class.java)
            val triggerAt = System.currentTimeMillis() + delayMs.coerceAtLeast(SOON_MS)
            val operation = pendingIntent(
                context,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            ) ?: return
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S || alarm.canScheduleExactAlarms()) {
                alarm.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, operation)
            } else {
                // 用户尚未开放精确闹钟时仍保留系统调度，只是恢复时刻可能被 Doze 延后。
                alarm.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, operation)
            }
        }

        fun scheduleSoon(context: Context) = schedule(context, SOON_MS)

        fun cancel(context: Context) {
            val operation = pendingIntent(
                context,
                PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE,
            ) ?: return
            context.getSystemService(AlarmManager::class.java).cancel(operation)
            operation.cancel()
        }
    }
}
