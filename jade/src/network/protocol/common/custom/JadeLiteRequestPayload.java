package net.minecraft.network.protocol.common.custom;

import net.minecraft.network.FriendlyByteBuf;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.resources.Identifier;

/**
 * Client to server: "tell me about the block I am looking at" for the Jade-style tooltip.
 * Wire format (channel jadelite:req): byte kind (0 = block), long block position
 * (BlockPos.asLong), varint entity id (unused for blocks).
 * A server that does not know this channel ignores it.
 */
public record JadeLiteRequestPayload(int kind, long pos, int entityId) implements CustomPacketPayload {
   public static final int BLOCK = 0;
   public static final Type<JadeLiteRequestPayload> TYPE = new Type<>(Identifier.parse("jadelite:req"));
   public static final StreamCodec<FriendlyByteBuf, JadeLiteRequestPayload> STREAM_CODEC = CustomPacketPayload.codec(
         (value, output) -> {
            output.writeByte(value.kind);
            output.writeLong(value.pos);
            output.writeVarInt(value.entityId);
         },
         input -> new JadeLiteRequestPayload(input.readUnsignedByte(), input.readLong(), input.readVarInt())
   );

   @Override
   public Type<JadeLiteRequestPayload> type() {
      return TYPE;
   }
}
