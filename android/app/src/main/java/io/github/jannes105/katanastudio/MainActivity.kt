package io.github.jannes105.katanastudio

import android.os.Bundle
import com.getcapacitor.BridgeActivity
import io.github.jannes105.katanastudio.usb.KatanaUsbPlugin

class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        // Must happen before super.onCreate(), which builds the bridge.
        registerPlugin(KatanaUsbPlugin::class.java)
        super.onCreate(savedInstanceState)
    }
}
