// Picks the language for server-written replies (checkout prompts, order confirmations,
// errors) so they match how the customer writes: Bangla script, Banglish (Bangla typed in
// English letters), or English.

export type ReplyLanguage = 'bn' | 'banglish' | 'en';

const BANGLA_SCRIPT = /[\u0980-\u09FF]/u;

const BANGLISH_WORDS = new Set([
  'ami', 'amar', 'amra', 'amader', 'apni', 'apnar', 'apnader', 'tumi', 'tomar', 'vai', 'bhai', 'apu',
  'ta', 'ti', 'gula', 'gulo', 'ekta', 'duita', 'dui', 'tinta', 'koyta', 'kotogula',
  'chai', 'chaai', 'nibo', 'nebo', 'nite', 'kinbo', 'kinte', 'lagbe', 'dorkar', 'diben', 'dien', 'den', 'dao',
  'koto', 'dam', 'daam', 'taka', 'ache', 'ase', 'achhe', 'nai', 'nei', 'hobe', 'hoy', 'hoibo', 'hocche',
  'kothay', 'kobe', 'keno', 'kivabe', 'kemon', 'ki', 'kore', 'korbo', 'koren', 'korte', 'korun',
  'thik', 'thikache', 'accha', 'acha', 'achha', 'haa', 'ha', 'hae', 'hya', 'ji', 'jee', 'jii', 'na', 'naa',
  'kintu', 'ar', 'theke', 'jonno', 'diye', 'ekhon', 'pore', 'ajke', 'kalke', 'shob', 'sob', 'bujhlam',
  'boltesi', 'bolchi', 'bolsi', 'koiren', 'ditesi', 'disi', 'dichi', 'pathan', 'pathiye',
]);

const ENGLISH_WORDS = new Set([
  'i', 'you', 'we', 'my', 'your', 'the', 'is', 'are', 'do', 'does', 'have', 'has', 'want', 'would', 'like',
  'please', 'price', 'how', 'much', 'many', 'what', 'where', 'when', 'can', 'could', 'buy', 'order', 'yes',
  'no', 'it', 'this', 'that', 'and', 'for', 'to', 'of', 'in', 'with', 'need', 'thanks', 'thank', 'okay',
  'sure', 'confirm', 'correct', 'address', 'phone', 'number', 'deliver', 'delivery', 'shop',
]);

const NEUTRAL_ACKS = new Set(['yes', 'yeah', 'yep', 'no', 'nope', 'ok', 'okay', 'sure', 'confirm', 'confirmed', 'correct', 'right', 'thanks', 'thank', 'you', 'please', 'done', 'cancel', 'it']);

function classify(text: string): ReplyLanguage | null {
  if (!text) return null;
  if (BANGLA_SCRIPT.test(text)) return 'bn';
  const words = text.toLowerCase().match(/[a-z]+/g) || [];
  // Short English acknowledgements ("yes", "ok confirm") are used by Banglish speakers too —
  // let earlier messages decide.
  if (words.length <= 3 && words.every((w) => NEUTRAL_ACKS.has(w))) return null;
  let banglish = 0;
  let english = 0;
  for (const w of words) {
    if (BANGLISH_WORDS.has(w)) banglish++;
    else if (ENGLISH_WORDS.has(w)) english++;
  }
  if (banglish === 0 && english === 0) return null;
  return banglish >= english ? 'banglish' : 'en';
}

/**
 * Language of the customer's latest message; if it carries no signal (e.g. "ok", a phone
 * number), falls back to their most recent earlier messages, then English.
 */
export function detectReplyLanguage(latest: string, previousCustomerTexts: string[] = []): ReplyLanguage {
  const direct = classify(latest);
  if (direct) return direct;
  for (let i = previousCustomerTexts.length - 1; i >= 0; i--) {
    const lang = classify(previousCustomerTexts[i]);
    if (lang) return lang;
  }
  return 'en';
}

const pick = (lang: ReplyLanguage, en: string, banglish: string, bn: string) =>
  lang === 'bn' ? bn : lang === 'banglish' ? banglish : en;

const contactLines = (lang: ReplyLanguage, phone: string, address: string) =>
  pick(
    lang,
    `• Phone: ${phone}\n• Address: ${address}`,
    `• Phone: ${phone}\n• Address: ${address}`,
    `• ফোন: ${phone}\n• ঠিকানা: ${address}`,
  );

// Every customer-facing message the server writes itself, in all three languages.
export function replyTexts(lang: ReplyLanguage) {
  return {
    cartAddConfirm: (qty: number, name: string, price: string, total: string) =>
      pick(
        lang,
        `You'd like ${qty}x ${name} at ${price} each — total ${total}. Would you like to confirm this order?`,
        `Apni ${qty}x ${name} nite chan, protita ${price} — mot ${total}. Order ta confirm korben?`,
        `আপনি ${qty}x ${name} নিতে চান, প্রতিটি ${price} — মোট ${total}। অর্ডারটি কনফার্ম করবেন?`,
      ),
    onlyAvailable: (inventory: number, name: string, max: number) =>
      pick(
        lang,
        `Sorry, we only have ${inventory} unit(s) of ${name} available. How many would you like (up to ${max})?`,
        `Dukkhito, ${name} er matro ${inventory} ta stock e ache. Apni koyta nite chan (${max} ta porjonto)?`,
        `দুঃখিত, ${name} এর মাত্র ${inventory}টি স্টকে আছে। আপনি কয়টি নিতে চান (${max}টি পর্যন্ত)?`,
      ),
    quantityUnavailable: () =>
      pick(
        lang,
        `Sorry, that quantity isn't available. Please choose another amount.`,
        `Dukkhito, oi quantity available nei. Onno ekta poriman bolun.`,
        `দুঃখিত, ওই পরিমাণ পাওয়া যাচ্ছে না। অন্য পরিমাণ বলুন।`,
      ),
    quantityRange: (max: number) =>
      pick(
        lang,
        `Please choose a quantity between 1 and ${max}.`,
        `1 theke ${max} er moddhe ekta quantity bolun.`,
        `১ থেকে ${max} এর মধ্যে একটি পরিমাণ বলুন।`,
      ),
    productNotFound: () =>
      pick(
        lang,
        `Sorry, I couldn't find that product in our catalog. Which item would you like?`,
        `Dukkhito, oi product ta amader catalog e pailam na. Apni kon product ta nite chan?`,
        `দুঃখিত, ওই পণ্যটি আমাদের ক্যাটালগে পাইনি। আপনি কোন পণ্যটি নিতে চান?`,
      ),
    startFresh: () =>
      pick(
        lang,
        `Done! I've cleared your cart and we're starting fresh. What would you like to shop for?`,
        `Done! Apnar cart clear kore dilam, notun kore shuru korchi. Ki kinte chan?`,
        `হয়ে গেছে! আপনার কার্ট খালি করে দিয়েছি, নতুন করে শুরু করছি। কী কিনতে চান?`,
      ),
    cancelOk: (refs: string[]) =>
      pick(
        lang,
        `Done! ${refs.length > 1 ? `Orders ${refs.join(', ')} have` : `Order ${refs[0]} has`} been cancelled successfully. Thank you!`,
        `Done! ${refs.length > 1 ? `${refs.join(', ')} order gulo` : `${refs[0]} order ta`} successfully cancel kora hoyeche. Dhonnobad!`,
        `হয়ে গেছে! ${refs.length > 1 ? `${refs.join(', ')} অর্ডারগুলো` : `${refs[0]} অর্ডারটি`} সফলভাবে বাতিল করা হয়েছে। ধন্যবাদ!`,
      ),
    cancelFail: () =>
      pick(
        lang,
        `I couldn't safely cancel that order. Please contact the store for help.`,
        `Oi order ta cancel kora gelo na. Doya kore store er sathe jogajog korun.`,
        `ওই অর্ডারটি বাতিল করা গেল না। অনুগ্রহ করে স্টোরের সাথে যোগাযোগ করুন।`,
      ),
    cancelAsk: (ordersText: string, count: number) =>
      pick(
        lang,
        `I found ${count > 1 ? 'these orders' : 'this order'}:\n${ordersText}\nDo you want me to cancel ${count > 1 ? 'them' : 'it'}? Reply "yes" to confirm, or "no" to keep ${count > 1 ? 'them' : 'it'}.`,
        `${count > 1 ? 'Ei order gulo' : 'Ei order ta'} pailam:\n${ordersText}\nCancel korbo? Confirm korte "ha" likhun, ar rakhte chaile "na" likhun.`,
        `${count > 1 ? 'এই অর্ডারগুলো' : 'এই অর্ডারটি'} পেয়েছি:\n${ordersText}\nবাতিল করব? নিশ্চিত করতে "হ্যাঁ" লিখুন, আর রাখতে চাইলে "না" লিখুন।`,
      ),
    cancelKept: (count: number) =>
      pick(
        lang,
        `No problem — ${count > 1 ? 'your orders stay' : 'your order stays'} active. Anything else I can help with?`,
        `Thik ache — ${count > 1 ? 'order gulo' : 'order ta'} active thakbe. Ar kichu lagbe?`,
        `ঠিক আছে — ${count > 1 ? 'অর্ডারগুলো' : 'অর্ডারটি'} চালু থাকবে। আর কিছু লাগবে?`,
      ),
    noOrderToCancel: () =>
      pick(
        lang,
        `I couldn't find an active order to cancel in this conversation. Please share more details if you still need help.`,
        `Ei conversation e cancel korar moto kono active order pailam na. Aro details dile help korte parbo.`,
        `এই কথোপকথনে বাতিল করার মতো কোনো চলমান অর্ডার পাইনি। আরও বিস্তারিত দিলে সাহায্য করতে পারব।`,
      ),
    quantityNoLongerAvailable: () =>
      pick(
        lang,
        `Sorry, that quantity is no longer available. Please choose a different quantity.`,
        `Dukkhito, oi quantity ar available nei. Onno quantity bolun.`,
        `দুঃখিত, ওই পরিমাণ আর পাওয়া যাচ্ছে না। অন্য পরিমাণ বলুন।`,
      ),
    checkoutContinueFailed: () =>
      pick(
        lang,
        `Sorry, we couldn't continue checkout for that item. Please try again.`,
        `Dukkhito, oi product er checkout continue kora gelo na. Abar try korun.`,
        `দুঃখিত, ওই পণ্যের চেকআউট চালিয়ে যাওয়া গেল না। আবার চেষ্টা করুন।`,
      ),
    contactConfirm: (summary: string, phone: string, address: string) =>
      pick(
        lang,
        `Before I place your order${summary ? ` (${summary})` : ''}, please confirm your delivery details:\n${contactLines(lang, phone, address)}\nIs this your phone number and address, and would you like your order delivered here? Reply "yes" to place the order, or send the correct phone number/address.`,
        `Order place korar age${summary ? ` (${summary})` : ''} apnar delivery details confirm korun:\n${contactLines(lang, phone, address)}\nEta ki apnar phone number ar address, ar order ta ki ekhane deliver korbo? Order place korte "ha" likhun, ba sothik phone number/address pathan.`,
        `অর্ডার দেওয়ার আগে${summary ? ` (${summary})` : ''} আপনার ডেলিভারির তথ্য নিশ্চিত করুন:\n${contactLines(lang, phone, address)}\nএটি কি আপনার ফোন নম্বর ও ঠিকানা, আর অর্ডারটি কি এখানে ডেলিভারি করব? অর্ডার দিতে "হ্যাঁ" লিখুন, অথবা সঠিক ফোন নম্বর/ঠিকানা পাঠান।`,
      ),
    askPhoneAndAddress: () =>
      pick(
        lang,
        `Great! To place your order, please share your phone number and full delivery address.`,
        `Darun! Order place korte apnar phone number ar puro delivery address ta din.`,
        `চমৎকার! অর্ডার দিতে আপনার ফোন নম্বর আর পুরো ডেলিভারি ঠিকানা দিন।`,
      ),
    askPhone: (address: string) =>
      pick(
        lang,
        `Thanks! I have your delivery address as: ${address}. Please also share your phone number.`,
        `Dhonnobad! Apnar delivery address: ${address}. Ebar apnar phone number ta din.`,
        `ধন্যবাদ! আপনার ডেলিভারি ঠিকানা: ${address}। এবার আপনার ফোন নম্বরটি দিন।`,
      ),
    askAddress: (phone: string) =>
      pick(
        lang,
        `Thanks! I have your phone number as: ${phone}. Please also share your full delivery address.`,
        `Dhonnobad! Apnar phone number: ${phone}. Ebar apnar puro delivery address ta din.`,
        `ধন্যবাদ! আপনার ফোন নম্বর: ${phone}। এবার আপনার পুরো ডেলিভারি ঠিকানা দিন।`,
      ),
    askCorrectContact: () =>
      pick(
        lang,
        `No problem! Please send the correct phone number and delivery address for this order.`,
        `Kono somossa nei! Ei order er jonno sothik phone number ar delivery address ta pathan.`,
        `কোনো সমস্যা নেই! এই অর্ডারের জন্য সঠিক ফোন নম্বর আর ডেলিভারি ঠিকানা পাঠান।`,
      ),
    checkoutCancelled: () =>
      pick(
        lang,
        `Okay, I've cancelled this checkout — no order was placed. Let me know if you'd like anything else!`,
        `Thik ache, checkout ta cancel kore dilam — kono order place hoyni. Ar kichu lagle janaben!`,
        `ঠিক আছে, চেকআউটটি বাতিল করেছি — কোনো অর্ডার দেওয়া হয়নি। আর কিছু লাগলে জানাবেন!`,
      ),
    orderInvalidItems: () =>
      pick(
        lang,
        `Sorry, we couldn't place that order with the requested items/quantity. Please adjust and try again.`,
        `Dukkhito, oi product/quantity diye order place kora gelo na. Ektu change kore abar try korun.`,
        `দুঃখিত, ওই পণ্য/পরিমাণ দিয়ে অর্ডার দেওয়া গেল না। একটু পরিবর্তন করে আবার চেষ্টা করুন।`,
      ),
    savedForMerchant: (phone: string, address: string) =>
      pick(
        lang,
        `Thank you! I've saved your order details and notified the store. A team member will finalize your order shortly.\n${contactLines(lang, phone, address)}`,
        `Dhonnobad! Apnar order details save kore store ke janiye diyechi. Amader team shighroi order ta finalize korbe.\n${contactLines(lang, phone, address)}`,
        `ধন্যবাদ! আপনার অর্ডারের তথ্য সংরক্ষণ করে স্টোরকে জানিয়েছি। আমাদের টিম শীঘ্রই অর্ডারটি চূড়ান্ত করবে।\n${contactLines(lang, phone, address)}`,
      ),
    orderPlaced: (phone: string, address: string) =>
      pick(
        lang,
        `Thank you! Your order has been placed.\n${contactLines(lang, phone, address)}\nWe'll deliver to this address. Thank you for shopping with us!`,
        `Dhonnobad! Apnar order place hoyeche.\n${contactLines(lang, phone, address)}\nEi address e deliver kora hobe. Amader theke kenakata korar jonno dhonnobad!`,
        `ধন্যবাদ! আপনার অর্ডার দেওয়া হয়েছে।\n${contactLines(lang, phone, address)}\nএই ঠিকানায় ডেলিভারি করা হবে। আমাদের কাছ থেকে কেনাকাটা করার জন্য ধন্যবাদ!`,
      ),
    outOfStock: () =>
      pick(
        lang,
        `Sorry, we don't have enough stock to complete that order right now. Please adjust your quantity and try again.`,
        `Dukkhito, ei muhurte order complete korar moto stock nei. Quantity komiye abar try korun.`,
        `দুঃখিত, এই মুহূর্তে অর্ডার সম্পূর্ণ করার মতো স্টক নেই। পরিমাণ কমিয়ে আবার চেষ্টা করুন।`,
      ),
    orderPlaceError: () =>
      pick(
        lang,
        `Sorry, something went wrong while placing your order. Please reply "yes" to try again, or a team member will follow up shortly.`,
        `Dukkhito, order place korte somossa hoyeche. Abar try korte "ha" likhun, ba amader team shighroi jogajog korbe.`,
        `দুঃখিত, অর্ডার দিতে সমস্যা হয়েছে। আবার চেষ্টা করতে "হ্যাঁ" লিখুন, অথবা আমাদের টিম শীঘ্রই যোগাযোগ করবে।`,
      ),
    askQuantity: (name: string, price: string) =>
      pick(
        lang,
        `${name} is ${price} per piece. How many would you like?`,
        `${name} er dam protita ${price}. Apni koyta nite chan?`,
        `${name} এর দাম প্রতিটি ${price}। আপনি কয়টি নিতে চান?`,
      ),
    showProduct: (name: string, price: string) =>
      pick(
        lang,
        `Here's ${name} — ${price}. Would you like to order it?`,
        `Ei je ${name} — ${price}. Order korte chan?`,
        `এই যে ${name} — ${price}। অর্ডার করতে চান?`,
      ),
    flaggedForReview: () =>
      pick(
        lang,
        `I'm sorry about that. A team member will look into this and get back to you shortly.`,
        `Er jonno dukkhito. Amader team bishoyta dekhe shighroi apnar sathe jogajog korbe.`,
        `এর জন্য দুঃখিত। আমাদের টিম বিষয়টি দেখে শীঘ্রই আপনার সাথে যোগাযোগ করবে।`,
      ),
  };
}
