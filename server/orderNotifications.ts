import { prisma } from './db';
import { deliverAgentReply } from './conversationEngine';
import { orderMessageSettings } from './businessProfile';
import { ORDER_MESSAGE_STATUS, type OrderMessageKey, type OrderStatusEnum } from '../shared/orderStatus';

export const ORDER_MESSAGES: Record<OrderMessageKey, string> = {
  ready: 'Good news — your order is packed and ready to ship. We will let you know once it is handed to the courier.',
  transit: 'Your order is on its way! It has been handed over to our delivery service.',
  out: 'Your order is out for delivery today. Please keep your phone nearby, and the cash ready if you are paying on delivery.',
  delivered: 'Your order has been delivered. Thank you for shopping with us — we would love to hear how you liked it!',
  failed: 'We could not deliver your order today. When would be a good time for us to try again?',
};

// Sent into the customer's chat as an AI message, only while the chat is still open (24 hours).
export async function sendOrderMessage(order: { conversationId: string | null; storeId: string }, text: string) {
  if (!order.conversationId) return;
  try {
    const conversation = await prisma.conversation.findUnique({ where: { id: order.conversationId } });
    if (!conversation || conversation.storeId !== order.storeId) return;
    const lastCustomer = await prisma.message.findFirst({
      where: { conversationId: conversation.id, sender: 'CUSTOMER' },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    if (!lastCustomer || Date.now() - lastCustomer.createdAt.getTime() > 24 * 60 * 60 * 1000) return;
    await prisma.message.create({ data: { conversationId: conversation.id, sender: 'AI', text, pending: false } });
    await prisma.conversation.update({ where: { id: conversation.id }, data: { lastMessageAt: new Date() } });
    await deliverAgentReply(conversation, text);
  } catch (err) {
    console.error('Failed to send order message:', err);
  }
}


/** Tells the customer about an order's new status, if the owner ticked that step in "Your business". */
export async function notifyOrderStatus(
  order: { conversationId: string | null; storeId: string },
  status: OrderStatusEnum,
  businessProfile: unknown,
  textOverride?: string | null,
) {
  const key = (Object.keys(ORDER_MESSAGE_STATUS) as OrderMessageKey[]).find((k) => ORDER_MESSAGE_STATUS[k] === status);
  if (key && orderMessageSettings(businessProfile)[key]) {
    await sendOrderMessage(order, textOverride || ORDER_MESSAGES[key]);
  }
}
