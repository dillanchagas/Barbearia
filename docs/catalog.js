export const barbers = [
  { id: "pek", name: "Pek" }, { id: "felipe", name: "Felipe Meneses" }, { id: "tiago", name: "Tiago Lopes" }
];
export const services = [
  ["maquina", "Corte à máquina", 9, 30], ["degrade", "Corte degradê", 14, 45],
  ["tradicional", "Corte tradicional", 12, 45], ["infantil", "Corte infantil", 11, 30],
  ["barba", "Barba completa ou à máquina", 10, 30], ["sobrancelha", "Sobrancelha à lâmina", 5, 15],
  ["contornos", "Contornos do cabelo", 5, 15], ["mascara", "Máscara negra", 10, 30],
  ["cabelo-barba", "Cabelo e barba", 20, 60], ["cabelo-sobrancelha", "Cabelo e sobrancelha", 15, 45],
  ["cabelo-barba-sobrancelha", "Cabelo, barba e sobrancelha", 22, 60],
  ["barba-sobrancelha", "Barba e sobrancelha", 12, 30],
  ["cabelo-barba-mascara", "Cabelo, barba e máscara negra", 28, 75],
  ["completo", "Cabelo, barba, sobrancelha e máscara negra", 30, 75],
  ["cabelo-mascara", "Cabelo e máscara negra", 20, 60],
  ["maquina-combo", "Cabelo e barba à máquina, sem degradê", 16, 45],
  ["cabelo-sobrancelha-mascara", "Cabelo, sobrancelha e máscara negra", 25, 60]
].map(([id,name,price,duration]) => ({id,name,price,duration}));
