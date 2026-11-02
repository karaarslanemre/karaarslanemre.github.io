// The example document: Emre's essay "Actuators" (Writing, October 2026),
// with every zoom level written in advance. It loads instantly and never uses
// the free AI allowance. The original paragraphs are a snapshot, so editing
// the essay in Pages CMS doesn't change this example.

export interface ExamplePassage {
  original: string;
  short: string;
  explained: string;
  basics: string;
}

export interface ExampleSection {
  title: string;
  summary: string;
  passages: ExamplePassage[];
}

export const EXAMPLE: { title: string; gist: string; sections: ExampleSection[] } = {
  title: 'Actuators',
  gist: `Washington now requires robots and drones sold in the US to be mostly American-made, but almost all of the motors that move them, called actuators, are built abroad. The author argues the winner will be whoever reaches scale first, makes the case that the startup Westmag can, and flags thin margins on drone motors as its biggest risk.`,
  sections: [
    {
      title: 'Giving machines muscles',
      summary: `The author’s first deal was the purchase of a chip designer that lets small devices run AI on their own. Chips give a machine a brain, but to move it also needs muscles: actuators, the motors inside every robot joint and drone rotor.`,
      passages: [
        {
          original: "A CPU is oddly cold. I remember being surprised by the feeling when I first built my PC. The moment was the culmination of months of research and planning, and dropping the CPU into place was the first step. When I finally watched it power on, I felt an immense sense of pride. I had brought something to life.",
          short: `Building a first PC, the author felt the pride of bringing a machine to life, starting with a surprisingly cold CPU.`,
          explained: `When I built my own computer for the first time, one thing surprised me: the CPU, the main chip that does the computer’s thinking, felt cold to the touch. Putting it in place was the first step of the build, after months of reading up and planning which parts to buy.

When the finished machine finally switched on and worked, I felt very proud. It felt like I had brought something to life.`,
          basics: `Every computer has a CPU, short for central processing unit. It’s a small, flat chip, a few centimeters across, that carries out the instructions behind everything a computer does. Because it does so much work, a running CPU gets hot, which is why computers have fans and metal heat sinks to carry the heat away.

Before it’s switched on, though, a CPU is just a cool piece of silicon, metal and plastic. The author noticed exactly that when building a first PC: the chip felt surprisingly cold in the hand.

Building a PC means buying the parts separately and fitting them together yourself: the CPU, the main circuit board it plugs into, memory, storage, a power supply and a case. The author spent months researching which parts to buy and how they fit together. Seating the CPU in its socket on the circuit board was the first step of the actual build.

Then came the moment of truth: pressing the power button. A computer you build yourself may not start at all if any part is wrong. When it did start, the author felt proud, as if they had brought something to life. That idea, bringing a machine to life, comes back in the next paragraph.`,
        },
        {
          original: "This summer, I worked on the acquisition of a physical AI chip designer that let small devices run AI on their own. Kind of fittingly, my first deal was about bringing machines to life. But chips only give a machine a brain. To actually move, it needs muscles, and in robots and drones those muscles are actuators, the motors inside every joint and rotor.",
          short: `The author’s first deal gave small devices an AI brain, but to move, robots and drones also need muscles: actuators, the motors in every joint and rotor.`,
          explained: `This summer I worked on my first deal: helping one company buy another. The company being bought designs chips for “physical AI”, meaning AI that runs inside machines out in the real world. Its chips let small devices run AI themselves, without leaning on a distant data center. That made it a fitting first deal, since it was also about bringing machines to life.

But a chip only gives a machine a brain. To actually move, a machine also needs muscles. In robots and drones, those muscles are actuators: the small motors inside every joint of a robot and under every spinning rotor of a drone.`,
          basics: `First, some terms. A deal here means an acquisition: one company buying another. People in finance help companies plan and carry out these purchases, and this summer the author worked on one.

The company being bought designs chips for “physical AI”. Most AI today runs in large data centers: your phone sends a question over the internet to big computers far away, and the answer comes back. Physical AI means AI that lives inside machines out in the world, like robots, drones or cameras, and helps them sense and act. This company’s chips are small and efficient enough that a small device can run AI by itself, on the spot.

The author found that fitting: a first deal about giving machines intelligence echoed the pride of bringing a first PC to life.

But think about what a body needs. A brain decides what to do; muscles do the moving. A chip is like a brain. It can decide, but it can’t move anything. To move, a machine needs something that turns electricity into motion. That’s an actuator.

In a robot, there’s an actuator inside every joint, like an elbow or a knee, turning to bend the limb. In a drone, the motor under each rotor spins the blades that push air down and keep it flying. Those motors are the drone’s actuators. Every robot and drone needs several of them, which is why they matter so much in the rest of the essay.`,
        },
      ],
    },
    {
      title: 'A market made by policy',
      summary: `New FCC rules shut new foreign-made robots and drones out of the US, and a robot now needs 65% of its parts cost to be domestic. Actuators are about half of a humanoid’s cost and almost all come from China, so there is no American robot without American actuators. Motors can’t get much better, so the winner will be whoever pools enough demand to reach scale first and gets designed in while makers redesign.`,
      passages: [
        {
          original: "Right now, almost all of those muscles are made abroad, and this year Washington decided that’s a problem. In July, the FCC barred new foreign-produced humanoids, quadrupeds and mobile robots from US authorization, seven months after doing the same to drones and their motors. To count as American-made, a robot now needs 65% of its component cost to be domestic, rising to 75% in 2029, and allied parts don’t count. Actuators are roughly half of a humanoid’s cost, so if they’re foreign, the robot tops out at about 50% domestic, well short of the 65% bar. Without American actuators, there is no American robot. Today that supply barely exists. China builds over 30 million more drone motors and robot actuators a year than the US, and even Tesla, despite its push to build in-house, still sources Optimus actuator components from China.",
          short: `New US rules require robots to be mostly American-made, which is impossible without American actuators, and today almost all of those come from China.`,
          explained: `Right now, almost all of these robot muscles are made in other countries, and this year the US government decided that’s a problem.

In July, the FCC, the agency that has to approve electronic devices before they can be sold in the US, stopped approving new humanoid robots, four-legged robots and other mobile robots made abroad. Seven months earlier, it had done the same for drones and their motors.

To count as American-made under the new rules, a robot needs at least 65% of the cost of its parts to come from the US. That bar rises to 75% in 2029, and parts made in allied countries don’t count toward it.

Here’s why actuators matter so much. They make up roughly half of what a humanoid robot costs. If the actuators are made abroad, then at most about 50% of the robot’s parts cost can be American, well short of the 65% required. Without American-made actuators, there can be no American-made robot.

Today, that American supply barely exists. China makes over 30 million more drone motors and robot actuators each year than the US does. Even Tesla, which is pushing to make parts for its Optimus humanoid robot itself, still buys components for Optimus’s actuators from China.`,
          basics: `Start with why a government would care where robot parts are made. Robots and drones are becoming important to factories, warehouses, farms and the military. If nearly all of their key parts come from one other country, that country could cut off supply, raise prices or build in security weaknesses. So governments sometimes use rules to push production back home.

One lever the US has is the FCC, the Federal Communications Commission. Electronic devices that give off radio signals, which includes anything with a wireless connection, like robots and drones, need FCC approval, called authorization, before they can be sold in the US. No authorization, no US market.

According to the author, the FCC pulled that lever twice. First it stopped authorizing new foreign-made drones and their motors. Seven months later, in July, it did the same for foreign-made humanoids (human-shaped robots), quadrupeds (four-legged robots, a bit like robot dogs) and other mobile robots.

How does a robot count as American-made? Add up what all its parts cost. Under the rule, at least 65% of that cost must come from US-made parts, rising to 75% in 2029. Parts from friendly countries don’t count.

Now the key arithmetic. Say a humanoid robot’s parts cost $100,000. The author says actuators are roughly half of a humanoid’s cost, so about $50,000. If those actuators come from abroad, then even if every other part is American, only $50,000 of $100,000, or 50%, is domestic. That’s well below the 65% needed, and no amount of other American parts can fix it. That’s why the author writes that without American actuators, there is no American robot.

The trouble is that the US barely makes these parts today. Making millions of motors takes factories, trained workers, special machines and suppliers of raw materials like steel and magnets, and China has built all of that over many years. The author says China makes over 30 million more drone motors and robot actuators a year than the US.

Even Tesla, a large US company working to make many of its own parts, still buys components for the actuators in Optimus, its humanoid robot, from China. If Tesla can’t easily avoid Chinese suppliers, smaller companies will find it harder still.`,
        },
        {
          original: "Motors are already near their efficiency limit, so the winner won’t be whoever builds a marginally better one. It’ll be whoever reaches scale first, by pooling demand from dozens of drone and robot makers that are each too small to justify their own motor line, and by getting designed into their products during the redesign wave these policy changes force.",
          short: `Because motors can barely get more efficient, the winner will be whoever reaches scale first, by pooling many small buyers and getting designed in during redesigns.`,
          explained: `Electric motors are already close to as efficient as they can get, so the company that wins this market won’t be the one that builds a slightly better motor. It will be the one that reaches large-scale production first.

There are two ways to get there. The first is pooling demand: there are dozens of drone and robot makers, and each is too small to justify building its own motor factory, but together they buy a lot of motors. The second is timing: the new rules force these companies to redesign their products around American parts, and a supplier whose motor gets chosen during that redesign becomes part of the product.`,
          basics: `A motor turns electrical energy into motion. Some energy is always lost along the way, mostly as heat. Efficiency measures how much of the energy that goes in comes out as useful motion. Good electric motors are already very efficient, often around 90%, and physics limits how close to 100% they can get. So there’s little room left for a newcomer to win by making a motor that works noticeably better.

If quality can’t set companies apart, cost can, and cost depends heavily on scale. A motor factory costs a lot up front, for machines, tools and setup, whether it makes 1,000 motors or 1 million. Spread a $10 million factory over 1,000 motors and each one carries $10,000 of that cost. Spread it over 1 million and each carries $10. The company producing the most units can charge the least.

There are dozens of drone and robot makers in the US, and each needs too few motors to justify building its own motor factory. A supplier that sells to many of them combines their orders into one large volume. That’s pooling demand.

Timing matters too. When a company designs a product, it picks specific parts, and switching later takes work, so the first choice often sticks. The new rules force drone and robot makers to redesign their products around American parts, all at roughly the same time. A supplier whose motors get chosen during that redesign wave, which the author calls getting designed in, wins customers while everyone is choosing at once.`,
        },
      ],
    },
    {
      title: 'Why Westmag can win',
      summary: `Westmag, an a16z-backed San Francisco startup, is betting on that gap. It starts with drones, where the Pentagon is buying in volume and Westmag already has large orders, and builds robot actuators on the same line. It also makes its own stator steel and magnets, and its founders know the Chinese motor supply chain and how to scale robots.`,
      passages: [
        {
          original: "That’s the plan at Westmag, a San Francisco-based startup that came out of stealth this June with a seed round led by a16z. Westmag is one of the earliest movers looking to fill this gap and I believe it can win for three reasons. First, it’s starting where there is already volume today. The Pentagon is planning to buy more than 200,000 small drones by 2027, and Westmag says it already has committed orders for hundreds of thousands of motors and actuators. Because most robot actuators have a drone-style motor at their core, it builds both on one line. Effectively, drones fund the factory, and robots are the bigger prize. Second, it is moving upstream where no one else will, stamping its own stator steel and finishing its own magnets. That lets it add new sizes quickly and control its costs. Third, the team. CEO David Hansen co-founded the e-bike startup Weel in 2018, traveled to China that year to source its motors, and spent 2020–21 learning the Chinese motor supply chain. COO Jordan Sanders spent 2.5 years as COO at Slip Robotics, scaling the company from launch to hundreds of robots at 25+ sites.",
          short: `Westmag can win because drones already give it volume to fund its factory, it makes its own steel and magnets, and its founders know motors and scaling.`,
          explained: `That’s exactly what Westmag plans to do. It’s a San Francisco startup that came out of stealth (began talking publicly about what it does) this June, with a seed round, its first major funding, led by the venture capital firm a16z (Andreessen Horowitz). It’s one of the first companies trying to fill this gap, and I think it can win for three reasons.

First, it starts where demand already exists. The Pentagon plans to buy more than 200,000 small drones by 2027, and Westmag says it already has firm orders for hundreds of thousands of motors and actuators. Most robot actuators are built around the same kind of motor a drone uses, so Westmag can make both on one production line. In effect, drone sales pay for the factory, and robots are the bigger opportunity.

Second, it makes parts further back in the supply chain that others won’t take on. It stamps its own stator steel (the thin steel sheets that form the fixed part of a motor) and finishes its own magnets (the permanent magnets the motor’s coils push and pull to make it spin). Doing this itself lets it add new motor sizes quickly and keep control of its costs.

Third, the team. CEO David Hansen co-founded the e-bike startup Weel in 2018, traveled to China that year to source its motors, and spent 2020 and 2021 learning how China’s motor supply chain works. COO Jordan Sanders spent two and a half years as COO of Slip Robotics, scaling the company from its launch to hundreds of robots at more than 25 sites.`,
          basics: `Westmag is a startup in San Francisco. Some startups work in “stealth”, keeping quiet about what they’re building. Westmag came out of stealth this June, announcing what it does along with its seed round, an early round of funding in which investors buy part of a young company. The round was led by a16z (Andreessen Horowitz), a well-known venture capital firm. The author sees Westmag as one of the first companies trying to fill the actuator gap and gives three reasons it could win.

Reason one: start where buyers already exist. A factory is expensive, and it only pays off when it runs at volume. The Pentagon, the headquarters of the US military, plans to buy more than 200,000 small drones by 2027, and every drone needs several motors. Westmag says it already has firm orders for hundreds of thousands of motors and actuators.

Here’s the clever part. A robot actuator is usually a motor plus a few other parts, such as gears that trade speed for strength, and the motor at its core is often like a drone’s. So one production line can make both. Drone orders keep the factory busy and paying for itself now, while robots, the bigger market, are the prize later.

Reason two: make the hard parts yourself. An electric motor has two main pieces. The stator stays still and holds coils of copper wire that become electromagnets when current flows. The rotor spins and carries permanent magnets. The stator’s shifting magnetic pull drags the magnets around, turning the rotor. The stator’s core is made of thin sheets of special steel, stamped into shape and stacked. The magnets need finishing: cutting, coating and magnetizing. These steps sit upstream, earlier in the supply chain, and few new companies want to take them on. Doing them itself means Westmag doesn’t wait on outside suppliers to try a new motor size, and it keeps more control over its costs.

Reason three: the people. David Hansen, the CEO, co-founded an e-bike startup called Weel in 2018. E-bikes run on electric motors, and that year Hansen traveled to China to source them, meaning to find suppliers and buy from them. In 2020 and 2021, Hansen studied how China’s motor supply chain works, the same supply chain Westmag now wants to rival. Jordan Sanders, the COO (chief operating officer, who runs day-to-day operations), held that role for two and a half years at Slip Robotics, taking it from launch to hundreds of robots working at more than 25 sites. Growing from a few machines to hundreds in the field is a hard, practical skill, and it’s what a new factory needs.`,
        },
      ],
    },
    {
      title: 'The risk: commodity drone motors',
      summary: `Drone motors are standard and easy to swap, so rivals like Unusual Machines and drone makers who build their own keep the moat thin, and the lowest cost wins. Robot actuators are stickier but still years away. Westmag must reach scale before policy protection fades, which means building factories early; the author wants to know what that costs and whether cheap government-backed loans can pay for it.`,
      passages: [
        {
          original: "The biggest risk sits on the drone side, where most of Westmag’s volume is today. Drone motors come in standard sizes and are easy to swap, so the moat there is thin. Unusual Machines already makes about 30,000 a month, and fast-growing drone makers like Neros build their own. On a commodity part, the lowest cost wins, so this is where stamping its own steel and finishing its own magnets has to pay off. Robot actuators are stickier, since they’re custom-fit to each robot, but that market is still a few years out. Westmag has to win enough drone business to reach scale and cost parity before policy protection fades, which means building factories ahead of demand. Before investing, I’d want to understand the capex needed per unit of capacity and how Westmag plans to fund it. The Pentagon has already committed more than $1.4 billion in conditional loans to US drone-component and magnet makers, and debt like that, backed by firm customer orders, would be way cheaper than raising equity at every step.",
          short: `Drone motors are an easily swapped commodity, so Westmag must reach scale and low costs before protection fades, and how it pays for factories matters.`,
          explained: `The biggest risk is on the drone side, which is where most of Westmag’s sales come from today. Drone motors come in standard sizes, so a drone maker can easily switch suppliers. That leaves Westmag little protection from competitors there: Unusual Machines already makes about 30,000 drone motors a month, and fast-growing drone makers like Neros make their own.

When a part is a commodity, meaning one supplier’s version is as good as another’s, the cheapest one wins. This is where making its own steel and magnets has to pay off, by giving Westmag lower costs than its rivals.

Robot actuators are a stickier business, because each one is custom-fit to a particular robot, so robot makers can’t easily switch. But that market is still a few years away.

So Westmag has to win enough drone business to reach large scale, with costs as low as anyone’s, before the protection from the new rules fades. That means building factories before the demand fully arrives.

Before investing, I’d want to understand how much it costs to build each unit of production capacity (the capex, or capital expenditure) and how Westmag plans to pay for it. The Pentagon has already committed more than $1.4 billion in conditional loans to US makers of drone components and magnets. Borrowing like that, backed by firm customer orders, would be much cheaper than selling more of the company to investors every time it needs money.`,
          basics: `Every business plan has a weak spot, and the author points to Westmag’s: drones, which bring in most of its volume today.

A moat is anything that protects a business from competitors, the way a moat protects a castle. Drone motors have a thin one. They come in standard sizes, so a drone maker can swap one supplier’s motor for another’s without redesigning anything. The author names two competitors: Unusual Machines already makes about 30,000 drone motors a month, and fast-growing drone makers like Neros build their own.

When products are interchangeable like this, they’re called commodities, like gasoline or wheat. Buyers of a commodity mostly pick the cheapest option. So on drone motors, Westmag has to be the low-cost producer. That’s the real test of making its own steel and magnets: it has to cut costs enough to beat rivals on price.

Robot actuators are different. Each one is custom-fit to a particular robot’s design, so once a robot maker picks a supplier, switching means redesigning. That makes customers sticky, and stickiness is a moat. But the author notes that this market is still a few years from being large.

That sets up a race. Today the new rules protect American suppliers by shutting out foreign ones, but the author expects that protection to fade. Before it does, Westmag needs to win enough drone business to reach scale and cost parity, meaning costs as low as its rivals’, so it can compete without the rules’ help. Getting to scale means building factories before all the demand shows up, which is risky and expensive.

That brings up capex, short for capital expenditure: money spent on long-lasting things like factories and machines. The author would want to know how much capex Westmag needs for each unit of production capacity, and how it will pay for it.

A company can raise money in two main ways. It can sell equity, a slice of ownership, which shrinks the founders’ and earlier investors’ share each time. Or it can borrow: take on debt that it repays with interest but that gives away no ownership. The Pentagon has committed more than $1.4 billion in conditional loans, loans offered if certain conditions are met, to US makers of drone parts and magnets. Debt like that, backed by firm customer orders that show the company can repay it, would cost far less than raising equity at every step.`,
        },
      ],
    },
  ],
};
