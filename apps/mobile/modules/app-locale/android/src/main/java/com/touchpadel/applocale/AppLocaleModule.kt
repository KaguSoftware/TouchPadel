package com.touchpadel.applocale

import android.content.Context
import android.content.res.Configuration
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.Locale

/**
 * Puts the app's chosen language on Android's own Configuration, so the
 * system's date and time dialogs (month names, weekday headers, OK/Cancel)
 * speak it instead of the phone's. See src/i18n/nativeLocale.ts.
 *
 * Layout is untouched: Fabric sets every React Native view's direction from
 * Yoga, so the RTL this implies only reaches the system's own dialogs.
 */
class AppLocaleModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("AppLocale")

    Function("apply") { tag: String ->
      val locale = Locale.forLanguageTag(tag)
      Locale.setDefault(locale)
      listOfNotNull(appContext.reactContext?.applicationContext, appContext.currentActivity)
        .forEach { update(it, locale) }
    }
  }

  @Suppress("DEPRECATION")
  private fun update(context: Context, locale: Locale) {
    val resources = context.resources
    val config = Configuration(resources.configuration)
    config.setLocale(locale)
    resources.updateConfiguration(config, resources.displayMetrics)
  }
}
