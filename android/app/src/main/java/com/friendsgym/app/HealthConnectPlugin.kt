package com.friendsgym.app

import android.content.Intent
import androidx.activity.result.ActivityResult
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.request.AggregateRequest
import androidx.health.connect.client.time.TimeRangeFilter
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.ActivityCallback
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import java.time.LocalDate
import java.time.ZoneId

@CapacitorPlugin(name = "HealthConnect")
class HealthConnectPlugin : Plugin() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val readStepsPermission = HealthPermission.getReadPermission(StepsRecord::class)
    private val permissionContract = PermissionController.createRequestPermissionResultContract()

    private fun sdkStatus(): Int = HealthConnectClient.getSdkStatus(context)

    @PluginMethod
    fun status(call: PluginCall) {
        val value = when (sdkStatus()) {
            HealthConnectClient.SDK_AVAILABLE -> "available"
            HealthConnectClient.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED -> "update-required"
            else -> "unavailable"
        }
        call.resolve(JSObject().put("status", value))
    }

    @PluginMethod
    fun requestStepsPermission(call: PluginCall) {
        if (sdkStatus() != HealthConnectClient.SDK_AVAILABLE) {
            call.resolve(JSObject().put("granted", false).put("unavailable", true))
            return
        }
        scope.launch {
            try {
                val client = HealthConnectClient.getOrCreate(context)
                val granted = client.permissionController.getGrantedPermissions()
                if (granted.contains(readStepsPermission)) {
                    call.resolve(JSObject().put("granted", true))
                } else {
                    val intent = permissionContract.createIntent(context, setOf(readStepsPermission))
                    startActivityForResult(call, intent, "healthPermissionResult")
                }
            } catch (error: Exception) {
                call.reject("Could not request Health Connect permission", error)
            }
        }
    }

    @ActivityCallback
    private fun healthPermissionResult(call: PluginCall?, result: ActivityResult) {
        if (call == null) return
        val granted = permissionContract.parseResult(result.resultCode, result.data)
        call.resolve(JSObject().put("granted", granted.contains(readStepsPermission)))
    }

    @PluginMethod
    fun readTodaySteps(call: PluginCall) {
        if (sdkStatus() != HealthConnectClient.SDK_AVAILABLE) {
            call.reject("Health Connect is unavailable on this device")
            return
        }
        scope.launch {
            try {
                val client = HealthConnectClient.getOrCreate(context)
                if (!client.permissionController.getGrantedPermissions().contains(readStepsPermission)) {
                    call.reject("Health Connect steps permission is not granted")
                    return@launch
                }
                val zone = ZoneId.systemDefault()
                val today = LocalDate.now(zone)
                val result = client.aggregate(AggregateRequest(
                    metrics = setOf(StepsRecord.COUNT_TOTAL),
                    timeRangeFilter = TimeRangeFilter.between(today.atStartOfDay(zone).toInstant(), java.time.Instant.now())
                ))
                call.resolve(JSObject().put("steps", result[StepsRecord.COUNT_TOTAL] ?: 0L).put("date", today.toString()).put("source", "health-connect"))
            } catch (error: Exception) {
                call.reject("Could not read today's steps", error)
            }
        }
    }

    @PluginMethod
    fun openSettings(call: PluginCall) {
        try {
            activity.startActivity(Intent(HealthConnectClient.ACTION_HEALTH_CONNECT_SETTINGS))
            call.resolve()
        } catch (error: Exception) {
            call.reject("Could not open Health Connect settings", error)
        }
    }

    override fun handleOnDestroy() {
        scope.cancel()
        super.handleOnDestroy()
    }
}
