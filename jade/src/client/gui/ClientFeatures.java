package net.minecraft.client.gui;

import org.teavm.jso.JSBody;

/**
 * Reads the feature switches the page keeps in {@code globalThis.__eaglerFeatures}
 * (see src/js/02f-features.js in the page sources). A missing object, as in a page
 * built without the switches, means every feature is on.
 */
final class ClientFeatures {
   private ClientFeatures() {
   }

   @JSBody(script = "var f=globalThis.__eaglerFeatures;return !f||f.jade!==false;")
   static native boolean jade();

   @JSBody(script = "var f=globalThis.__eaglerFeatures;return !f||f.coords!==false;")
   static native boolean coords();

   /** One of "tl", "tr", "bl", "br". */
   @JSBody(script = "var f=globalThis.__eaglerFeatures;var p=f&&f.coordsPos;return p==='tr'||p==='bl'||p==='br'?p:'tl';")
   static native String coordsPos();
}
