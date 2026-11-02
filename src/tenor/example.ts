// The example: eight quarters of earnings calls from Corvane Systems, a
// company invented for this page. Every name, figure and quote is made up.
// The transcripts are written in the same layout real ones use, so the example
// runs through exactly the same reading and scoring as an uploaded PDF.
//
// The arc: two strong years of AI-driven demand, bookings that quietly turn in
// Q4 FY24, a script that stays upbeat while the answers get vaguer, a guidance
// cut in Q2 and Q3 FY25, and steadier, more specific answers by Q4 FY25.

const COMPANY = 'Corvane Systems (CRVN)';
const EXECS = {
  ir: 'Grace Lin -- Vice President, Investor Relations',
  ceo: 'Dana Whitfield -- Chief Executive Officer',
  cfo: 'Rahul Mehta -- Chief Financial Officer',
};
const ANALYSTS = {
  priya: 'Priya Raman -- Halvorsen Securities -- Analyst',
  marcus: 'Marcus Webb -- Tideline Capital Markets -- Analyst',
  elena: 'Elena Sato -- Brookfeld & Co. -- Analyst',
  tom: 'Tom Okafor -- Kestrel Research Partners -- Analyst',
};
type Analyst = keyof typeof ANALYSTS;
type Speaker = 'ceo' | 'cfo';

interface Quarter {
  q: number;
  fy: number;
  date: string;
  ceo: string[];
  cfo: string[];
  qa: Array<{ who: Analyst; ask: string; answers: Array<[Speaker, string]> }>;
  close: string;
}

const ORDINAL = ['first', 'second', 'third', 'fourth'];
const INTRO_FROM: Record<Analyst, string> = {
  priya: 'Priya Raman with Halvorsen Securities',
  marcus: 'Marcus Webb with Tideline Capital Markets',
  elena: 'Elena Sato with Brookfeld & Co.',
  tom: 'Tom Okafor with Kestrel Research Partners',
};

function transcript(x: Quarter): string {
  const quarter = `${ORDINAL[x.q - 1]} quarter fiscal ${x.fy}`;
  const out: string[] = [
    `${COMPANY} Q${x.q} FY${x.fy} Earnings Call Transcript`,
    `${x.date}, 5:00 p.m. ET`,
    '',
    'Corporate Participants',
    EXECS.ir,
    EXECS.ceo,
    EXECS.cfo,
    '',
    'Conference Call Participants',
    ...Object.values(ANALYSTS),
    '',
    'Prepared Remarks:',
    '',
    'Operator',
    '',
    `Good afternoon, and welcome to the Corvane Systems ${quarter} earnings conference call. At this time, all participants are in a listen-only mode. I would now like to turn the call over to Grace Lin, Vice President of Investor Relations.`,
    '',
    EXECS.ir,
    '',
    `Thank you, and good afternoon, everyone. With me today are Dana Whitfield, our Chief Executive Officer, and Rahul Mehta, our Chief Financial Officer.`,
    '',
    `Before we begin, I'd like to remind you that today's discussion contains forward-looking statements that are subject to risks and uncertainties, and actual results may differ materially. Please refer to the risk factors in our filings with the SEC. We will also discuss non-GAAP financial measures; reconciliations to the most comparable GAAP measures are in our earnings release. With that, I'll turn the call over to Dana.`,
    '',
    EXECS.ceo,
    '',
    ...x.ceo.flatMap((p) => [p, '']),
    EXECS.cfo,
    '',
    ...x.cfo.flatMap((p) => [p, '']),
    'Questions & Answers:',
    '',
    'Operator',
    '',
    `Thank you. We will now begin the question-and-answer session. Our first question comes from ${INTRO_FROM[x.qa[0].who]}.`,
    '',
  ];
  x.qa.forEach((ex, i) => {
    if (i > 0) out.push('Operator', '', `Our next question comes from ${INTRO_FROM[ex.who]}.`, '');
    out.push(ANALYSTS[ex.who], '', ex.ask, '');
    for (const [who, text] of ex.answers) out.push(EXECS[who], '', text, '');
  });
  out.push('Operator', '', 'There are no further questions at this time. I will turn the call back over to Dana Whitfield for closing remarks.', '');
  out.push(EXECS.ceo, '', x.close, '');
  out.push('Operator', '', `This concludes today's conference call. Thank you for participating. You may now disconnect.`);
  return out.join('\n');
}

const QUARTERS: Quarter[] = [
  {
    q: 1,
    fy: 2024,
    date: 'April 24, 2024',
    ceo: [
      `Thank you, Grace, and thanks to everyone for joining. We delivered a strong start to the year. Revenue was $412 million, up 18% year over year and ahead of the high end of our guidance. Bookings were $468 million, a book-to-bill of 1.14, and demand was broad-based across our automotive, logistics and electronics customers.`,
      `The standout this quarter was our Vision AI platform. 31% of new robot cells shipped with Vision AI attached, up from 22% a year ago, and customers who adopt it are expanding their fleets faster. We won three new automotive programs in Europe, and our largest logistics customer committed to a second wave of deployments across 40 sites.`,
      `We are executing well, our pipeline is the strongest it has been, and I am confident we will deliver another year of profitable growth.`,
    ],
    cfo: [
      `Thanks, Dana. Revenue of $412 million grew 18%. Gross margin was 46.2%, up 90 basis points, driven by favorable mix toward software and better factory utilization. Operating margin was 17.4%, and we generated $61 million of free cash flow.`,
      `Backlog ended the quarter at $1.02 billion. For the second quarter, we expect revenue of $425 million to $435 million. For the full year, we are raising our outlook to $1.78 billion to $1.84 billion. We also repurchased $40 million of stock in the quarter.`,
    ],
    qa: [
      {
        who: 'priya',
        ask: `Congrats on a great quarter. Dana, the Vision AI attach rate jumped to 31%. Can you talk about what's driving that and where it can go by the end of the year?`,
        answers: [
          ['ceo', `Thanks, Priya. Two things are driving it. First, the accuracy gains in our latest release are real, so customers see fewer line stoppages, and second, pricing it per cell rather than per site made it an easy decision. We think attach can reach the high 30s by the fourth quarter, and we will keep investing to get there.`],
        ],
      },
      {
        who: 'marcus',
        ask: `Thanks. Rahul, gross margin was up 90 basis points. How much of that came from software mix versus utilization, and is 46% a good level for the rest of the year?`,
        answers: [
          ['cfo', `Sure, Marcus. About 60 basis points came from mix and about 30 from utilization. We expect gross margin of 46% to 47% for the rest of the year. The software mix is a lasting tailwind, while utilization can move around quarter to quarter.`],
        ],
      },
      {
        who: 'elena',
        ask: `On the logistics win across 40 sites, what is the timing of those deployments, and how big is the program in dollars?`,
        answers: [
          ['ceo', `The first 12 sites go live in the third quarter and the rest through next year. Over the full program it is roughly $90 million of hardware plus recurring software, so it is our largest single logistics award to date.`],
        ],
      },
      {
        who: 'tom',
        ask: `You raised the full-year outlook by $30 million at the midpoint. What would it take to land at the high end of the range?`,
        answers: [
          ['cfo', `Mostly the timing of automotive programs in the second half. If the European programs ramp on schedule, the high end is achievable. We have good visibility, with backlog covering about 70% of the remaining revenue for the year.`],
        ],
      },
    ],
    close: `Thank you all for joining. We are pleased with the start to the year and excited about the momentum in Vision AI. We look forward to updating you next quarter.`,
  },
  {
    q: 2,
    fy: 2024,
    date: 'July 25, 2024',
    ceo: [
      `Thank you, Grace. This was an outstanding quarter. Revenue was $441 million, up 21%, and bookings reached a record $512 million. Every region grew, and our Vision AI attach rate climbed to 36%, ahead of the target we set just three months ago.`,
      `Customers are moving from pilots to fleet-wide rollouts. We signed our first two semiconductor fabs, a segment we have wanted to win for years, and both chose Vision AI for inspection. Our new Atlas controller launched on time and the early feedback is excellent.`,
      `Demand is strong, our competitive position has never been better, and we are raising our outlook again.`,
    ],
    cfo: [
      `Thanks, Dana. Revenue of $441 million grew 21%, another strong result. Gross margin was 46.8%, up 120 basis points, and operating margin was 18.1%, a record for us. Free cash flow was $74 million, our best second quarter ever.`,
      `Backlog grew to $1.13 billion. For the third quarter, we expect revenue of $455 million to $465 million. We are raising full-year revenue to $1.84 billion to $1.90 billion and now expect operating margin of about 18%.`,
    ],
    qa: [
      {
        who: 'marcus',
        ask: `Congrats on the record bookings, that's a great result. How much of the $512 million came from the two semiconductor fabs, and are there more of those in the pipeline? It seems like a big new market for you.`,
        answers: [
          ['ceo', `Thanks, Marcus. The two fabs were about $38 million together. The pipeline has five more semiconductor opportunities, and we expect to close at least two of them by year end. It is an exciting new market for us.`],
        ],
      },
      {
        who: 'tom',
        ask: `Rahul, operating margin hit 18.1%. How should we think about operating expenses in the second half as you ramp Atlas?`,
        answers: [
          ['cfo', `We expect operating expenses to grow about 12% in the second half, mostly engineering for Atlas and Vision AI. Because revenue is growing faster than that, we still expect margin expansion, and we are confident in about 18% for the year.`],
        ],
      },
      {
        who: 'priya',
        ask: `Dana, you mentioned pilots turning into fleet rollouts. What share of bookings now comes from rollouts rather than new pilots?`,
        answers: [
          ['ceo', `About 64% of bookings this quarter came from expansions at existing customers, up from 51% a year ago. That is exactly the pattern we want, because expansions convert faster and carry better margins.`],
        ],
      },
      {
        who: 'elena',
        ask: `Any change in pricing? With demand this strong, are you able to raise prices on the new controller?`,
        answers: [
          ['cfo', `Yes. Atlas is priced about 8% above the controller it replaces, and so far we have seen no pushback. Pricing on the rest of the portfolio is stable.`],
        ],
      },
    ],
    close: `Thank you, everyone. It was a record quarter on several fronts, and I want to thank our teams for the excellent execution. We will talk to you in October.`,
  },
  {
    q: 3,
    fy: 2024,
    date: 'October 24, 2024',
    ceo: [
      `Thank you, Grace. We delivered another excellent quarter. Revenue was $463 million, up 23%, and bookings set a new record at $530 million. Vision AI attach reached 39%, so we exceeded our year-end target a quarter early.`,
      `We closed two more semiconductor fabs and won the largest automotive program in our history, a multiyear award from a European automaker worth about $140 million. Our AI roadmap is resonating with customers, and we are winning against every major competitor.`,
      `I have never been more confident in our strategy. We will continue to invest to extend our lead in AI-driven automation.`,
    ],
    cfo: [
      `Thanks, Dana. Revenue of $463 million grew 23%. Gross margin was 47.1%, up 140 basis points, as software mix continued to improve, and operating margin was a strong 18.6%. Free cash flow was an excellent $82 million, and we repurchased $60 million of stock.`,
      `Backlog reached a record $1.21 billion. For the fourth quarter, we expect revenue of $480 million to $490 million, and we are raising the full year to $1.88 billion to $1.92 billion.`,
    ],
    qa: [
      {
        who: 'tom',
        ask: `Congratulations on the automotive award. How does the $140 million split across years, and does it change your margin outlook?`,
        answers: [
          ['ceo', `Thanks, Tom. About $35 million lands in fiscal 2025, $65 million in 2026 and the rest in 2027. Margins on the program are in line with our corporate average, so it does not change the outlook.`],
        ],
      },
      {
        who: 'priya',
        ask: `Vision AI attach is at 39%. Is there a ceiling, and what does the next leg of growth look like?`,
        answers: [
          ['ceo', `We think attach can reach 50% over the next two years. The next leg is software that spans a whole plant rather than a single cell. We will launch the first of those products in the second quarter of next year.`],
        ],
      },
      {
        who: 'elena',
        ask: `Rahul, the fourth-quarter guide implies slower sequential growth than the past few quarters. Is that conservatism or something you're seeing?`,
        answers: [
          ['cfo', `It is mostly the timing of shipments. Two large logistics deployments move from the fourth quarter into the first quarter at the customer's request. Underlying demand remains strong, and bookings are running well ahead of revenue.`],
        ],
      },
      {
        who: 'marcus',
        ask: `Any changes in the competitive landscape? We hear new entrants are targeting vision inspection with lower prices. Are you seeing them in deals yet?`,
        answers: [
          ['ceo', `We see them, but our win rate this quarter was 68%, our best ever. Customers value an integrated system with proven uptime, and that is where we lead.`],
        ],
      },
    ],
    close: `Thank you for joining us. We are proud of the results and confident in the opportunity ahead. We look forward to sharing our fiscal 2025 outlook in February.`,
  },
  {
    q: 4,
    fy: 2024,
    date: 'February 6, 2025',
    ceo: [
      `Thank you, Grace. Fiscal 2024 was a record year. Revenue was $1.805 billion, up 21%, and fourth-quarter revenue of $489 million grew 24%. Vision AI attach finished the year at 41%, well ahead of plan.`,
      `We exceeded every major goal we set this year. We entered semiconductors, launched Atlas, and won the largest program in our history. As we look to fiscal 2025, we are investing to lead the next wave of AI automation, and we expect another year of strong growth.`,
      `Fourth-quarter bookings were $498 million, a book-to-bill of 1.02, as some customers timed orders around their budget cycles. Our pipeline remains robust.`,
    ],
    cfo: [
      `Thanks, Dana. Fourth-quarter revenue of $489 million grew 24%. Gross margin was 46.9% and operating margin was 18.4%. For the full year, free cash flow was $295 million.`,
      `For fiscal 2025, we expect revenue of $2.05 billion to $2.15 billion, growth of 14% to 19%, and operating margin of 18% to 19%. For the first quarter, we expect revenue of $465 million to $480 million.`,
    ],
    qa: [
      {
        who: 'marcus',
        ask: `Dana, bookings were down sequentially for the first time in two years. How much of that was budget timing versus softer demand, and what have you seen so far in January?`,
        answers: [
          ['ceo', `It was mostly timing. Several customers pushed orders from December into the new year. January bookings are tracking in line with our plan. We feel good about demand.`],
        ],
      },
      {
        who: 'priya',
        ask: `The fiscal 2025 guide of 14% to 19% growth is a step down from 21%. Can you walk us through the assumptions at the low and high end?`,
        answers: [
          ['cfo', `Sure. The low end assumes book-to-bill around 1.0 and no improvement in the macro. The high end assumes semiconductor wins ramp as planned and Vision AI attach reaches 45%. Backlog of $1.19 billion covers about 55% of the midpoint.`],
        ],
      },
      {
        who: 'tom',
        ask: `On the plant-wide software launch next quarter, how should we think about pricing and its contribution to fiscal 2025?`,
        answers: [
          ['ceo', `It is a subscription, priced per plant. We are not expecting a large contribution in fiscal 2025, perhaps $10 million to $15 million, but it sets up recurring revenue for 2026 and beyond.`],
        ],
      },
      {
        who: 'elena',
        ask: `You are guiding operating margin to 18% to 19%. Is there any pricing pressure built into that from the new entrants in vision inspection?`,
        answers: [
          ['cfo', `We have assumed stable pricing. We have seen a few aggressive bids, but they have not changed our win rate. The margin range is about mix and investment pacing.`],
        ],
      },
    ],
    close: `Thank you all. Fiscal 2024 was a record year and we enter 2025 with a strong backlog and an exciting product roadmap. Talk to you in April.`,
  },
  {
    q: 1,
    fy: 2025,
    date: 'April 23, 2025',
    ceo: [
      `Thank you, Grace. We delivered a solid first quarter. Revenue was $472 million, up 15% and within our guidance range. Vision AI attach rose to 43%, and we launched our plant-wide software, Corvane Fabric, on schedule with eight customers signed.`,
      `Bookings were $431 million. As we said in February, some customers are timing orders around their budget cycles and new plant schedules, and we expect bookings to improve as the year progresses. Our competitive position remains strong and our pipeline is healthy.`,
      `We remain confident in our strategy and in the long-term opportunity in AI automation.`,
    ],
    cfo: [
      `Thanks, Dana. Revenue of $472 million grew 15%. Gross margin was 46.0%, and operating margin was 17.2%. Free cash flow was $52 million.`,
      `Backlog ended at $1.15 billion. For the second quarter, we expect revenue of $455 million to $470 million. We are maintaining our full-year outlook of $2.05 billion to $2.15 billion, though we now expect to land in the lower half of the range.`,
    ],
    qa: [
      {
        who: 'marcus',
        ask: `Dana, book-to-bill was 0.91, the second straight quarter below one. How much of the decline was order timing versus lower demand? Can you quantify how many orders slipped and how much of that you have already booked in April?`,
        answers: [
          ['ceo', `As I mentioned in my remarks, a lot of this is timing. We don't break out the timing effect specifically. What I would say is that we feel very good about our position over the long term, and our customers continue to tell us that automation is a top priority.`],
        ],
      },
      {
        who: 'priya',
        ask: `You're now pointing to the lower half of the range. What changed since February, and what would get you to the low end?`,
        answers: [
          ['cfo', `The main change is the timing of a few large automotive programs, which may shift to later in the year. The low end would assume those programs slip further and that bookings stay around current levels. We think that is unlikely, but it is possible.`],
        ],
      },
      {
        who: 'elena',
        ask: `Gross margin fell to 46%. Is that pricing, mix or utilization, and how many basis points came from each?`,
        answers: [
          ['cfo', `It is a combination of factors, and it can move around from quarter to quarter. Utilization was somewhat lower with the shipment timing, and mix was a bit less favorable. We still expect margins to improve in the second half.`],
        ],
      },
      {
        who: 'tom',
        ask: `On Corvane Fabric, eight customers is a good start. What does the pipeline look like for the rest of the year?`,
        answers: [
          ['ceo', `We have more than 30 plants in active evaluation, and we expect 20 to 25 to be live by year end. Early customers are seeing downtime fall by about 15%, which is a strong proof point.`],
        ],
      },
    ],
    close: `Thank you, everyone. We are executing on our roadmap and remain confident in the opportunity ahead. Talk to you in July.`,
  },
  {
    q: 2,
    fy: 2025,
    date: 'July 24, 2025',
    ceo: [
      `Thank you, Grace. The second quarter was more challenging than we expected. Revenue was $455 million, up 3%, at the low end of our guidance. Bookings were $402 million, as customers delayed decisions on new lines, and we faced more aggressive pricing from new entrants in vision inspection.`,
      `We are taking action. We are focusing our sales teams on our largest accounts, accelerating cost savings, and sharpening our pricing on entry-level systems. Vision AI attach held at 43%, and Corvane Fabric is now live in 17 plants.`,
      `We are adjusting our outlook to reflect the current environment. We believe the long-term demand for automation remains intact, and we are committed to protecting our margins.`,
    ],
    cfo: [
      `Thanks, Dana. Revenue of $455 million grew 3%. Gross margin was 44.1%, down 270 basis points, mainly from pricing on entry-level systems and lower utilization. Operating margin was 14.6%.`,
      `We are lowering our full-year outlook to $1.90 billion to $1.98 billion, and we now expect operating margin of about 15%. For the third quarter, we expect revenue of $430 million to $450 million. We have paused share repurchases for now.`,
    ],
    qa: [
      {
        who: 'elena',
        ask: `Gross margin was down 270 basis points. How much of that was pricing versus utilization, and how many more points of price could you give up to defend share?`,
        answers: [
          ['cfo', `We're not going to give a specific split, because it depends on several moving parts. Pricing was a meaningful factor in entry-level systems, and utilization was lower. Going forward, it depends on how the competitive environment develops, and we will be disciplined.`],
        ],
      },
      {
        who: 'marcus',
        ask: `Bookings fell again to $402 million. Are customers cancelling orders or just delaying them, and what share of backlog is at risk?`,
        answers: [
          ['ceo', `We have not seen meaningful cancellations. Customers are delaying decisions, and it's hard to say exactly when those decisions come back. I'd take a step back and point to the broader picture: automation is a long-term trend, and we are well positioned for it.`],
        ],
      },
      {
        who: 'priya',
        ask: `The new guide implies a much weaker second half. What does it assume for bookings, and how confident are you in the low end?`,
        answers: [
          ['cfo', `The guide assumes bookings stay roughly at current levels. There is uncertainty in the timing of large programs, and the environment remains fluid, so we have tried to be prudent. We feel the range is appropriate.`],
        ],
      },
      {
        who: 'tom',
        ask: `Which competitors are you losing to, and is it only entry-level systems or is it starting to show up in larger fleet deals?`,
        answers: [
          ['ceo', `It is mainly entry-level systems, where two new competitors are pricing about 20% below us. In larger fleet deals our win rate is still above 60%, because uptime and service matter more there.`],
        ],
      },
    ],
    close: `Thank you, everyone. This was a difficult quarter, and we are acting decisively. We will update you in October.`,
  },
  {
    q: 3,
    fy: 2025,
    date: 'October 23, 2025',
    ceo: [
      `Thank you, Grace. The third quarter was difficult. Revenue was $428 million, down 8%, and bookings were $389 million. Demand from automotive customers weakened further as several programs were delayed, and pricing pressure in entry-level systems continued.`,
      `We are announcing a restructuring to reduce our cost base by about $60 million a year, including a reduction of about 7% of our workforce. These are hard decisions, and they are necessary to protect our ability to invest in Vision AI and Corvane Fabric, which continues to grow.`,
      `We are lowering our outlook again. The environment may remain uncertain for some time, but we believe our technology position is strong.`,
    ],
    cfo: [
      `Thanks, Dana. Revenue of $428 million declined 8%. Gross margin was 42.7%, and operating margin was 11.2% before restructuring charges of $24 million. Free cash flow was $18 million.`,
      `We now expect full-year revenue of $1.80 billion to $1.84 billion. For the fourth quarter, we expect revenue of $420 million to $445 million. We expect the restructuring to be largely complete by the end of the first quarter.`,
    ],
    qa: [
      {
        who: 'marcus',
        ask: `This is the second cut in a row. What gives you confidence the new range is the bottom? How much of the fourth quarter is already in backlog?`,
        answers: [
          ['ceo', `As we said earlier, the environment is uncertain, and I don't want to get ahead of ourselves. We've tried to reflect what we can see today. We are focused on what we can control, which is our costs, our products and our customers.`],
        ],
      },
      {
        who: 'elena',
        ask: `Gross margin is now 42.7%. How much of the decline is structural from pricing, and how much comes back when volume recovers? Can you give us a number for the pricing impact?`,
        answers: [
          ['cfo', `It's too early to say how much is structural. Some of it should come back with volume, and some depends on the competitive environment, which could stay difficult. We'll share more on that when we give our fiscal 2026 outlook.`],
        ],
      },
      {
        who: 'priya',
        ask: `Dana, how many of the delayed automotive programs have been formally pushed out, and has any customer cancelled?`,
        answers: [
          ['ceo', `I won't comment on individual customers. Some programs have moved and some may move again. It really depends on our customers' own production plans, which are uncertain right now.`],
        ],
      },
      {
        who: 'tom',
        ask: `With the restructuring, are you cutting any engineering on Vision AI or Fabric? And what is the new run-rate for operating expenses?`,
        answers: [
          ['cfo', `No cuts to the Vision AI or Fabric roadmaps. The savings come mostly from sales coverage, general and administrative costs and manufacturing overhead. After the restructuring, we expect quarterly operating expenses of about $128 million, down from $143 million.`],
        ],
      },
      {
        who: 'marcus',
        ask: `A follow-up on capital allocation. Will you resume buybacks, and is the dividend safe?`,
        answers: [
          ['cfo', `We'll evaluate capital return when we have better visibility. We remain committed to the dividend.`],
        ],
      },
    ],
    close: `Thank you for joining. This is a challenging period, and we are making the changes we need to make. We will talk to you in February.`,
  },
  {
    q: 4,
    fy: 2025,
    date: 'February 5, 2026',
    ceo: [
      `Thank you, Grace. The fourth quarter showed the first signs of stabilization. Revenue was $437 million, down 11% from a year ago but up 2% from the third quarter, and bookings improved to $455 million, a book-to-bill of 1.04, our first quarter above one in five quarters.`,
      `Three of the delayed automotive programs were released for production, and Corvane Fabric is now live in 31 plants, with recurring revenue of $26 million a year. In entry-level systems, our new Atlas Lite controller is winning back share at better margins.`,
      `We are not declaring victory. The environment is still uncertain. But we are encouraged by the improvement in orders, and the restructuring is on track.`,
    ],
    cfo: [
      `Thanks, Dana. Revenue of $437 million was down 11% year over year and up 2% sequentially. Gross margin improved to 43.9%, up 120 basis points from the third quarter, driven by Atlas Lite and $11 million of restructuring savings. Operating margin was 13.1%.`,
      `For fiscal 2026, we expect revenue of $1.85 billion to $1.95 billion and operating margin of 14% to 16%. The low end assumes book-to-bill of 0.95 and no further price changes; the high end assumes book-to-bill of 1.1. Backlog of $1.06 billion covers about 52% of the midpoint. We expect first-quarter revenue of $430 million to $445 million, and we will resume repurchases with $50 million authorized for the first half.`,
    ],
    qa: [
      {
        who: 'marcus',
        ask: `Book-to-bill of 1.04 is encouraging. How much of the $455 million came from the three released automotive programs, and is that repeatable?`,
        answers: [
          ['ceo', `About $62 million came from those three programs. Excluding them, bookings were $393 million, roughly flat with the third quarter. So the improvement is real but concentrated, and we have assumed a lower run-rate in the guide.`],
        ],
      },
      {
        who: 'elena',
        ask: `Gross margin recovered 120 basis points. Can you split that between Atlas Lite and restructuring savings, and where does it go in 2026?`,
        answers: [
          ['cfo', `About 70 basis points came from Atlas Lite pricing and mix and about 50 from savings. For fiscal 2026 we expect gross margin of 44% to 45%, with the full $60 million of savings in the run-rate by the second quarter.`],
        ],
      },
      {
        who: 'priya',
        ask: `Dana, on pricing in entry-level systems, are competitors still 20% below you, and have you had to match them?`,
        answers: [
          ['ceo', `They are still about 15% to 20% below on comparable systems. We have not matched them. Atlas Lite costs us about 18% less to build, so we can price it 10% lower and still earn our target margin. We won 9 of the last 14 entry-level deals.`],
        ],
      },
      {
        who: 'tom',
        ask: `Nice to see orders improving. What would make you raise the 2026 outlook during the year, and what would push you toward the low end?`,
        answers: [
          ['cfo', `Two things: book-to-bill staying above 1.05 for two quarters, and Fabric adoption reaching 50 plants. If both happen, we would expect to be in the upper half of the range. The low end would be book-to-bill back below 1.0, or another round of price cuts from competitors.`],
        ],
      },
    ],
    close: `Thank you, everyone. We have work to do, but the business is steadier and our orders are improving. We look forward to updating you in April.`,
  },
];

export const EXAMPLE_COMPANY = 'Corvane Systems';

/** The eight transcripts, oldest first, with a file-like name for each. */
export const EXAMPLE: Array<{ name: string; text: string }> = QUARTERS.map((x) => ({
  name: `Corvane Q${x.q} FY${String(x.fy).slice(2)}.pdf`,
  text: transcript(x),
}));
